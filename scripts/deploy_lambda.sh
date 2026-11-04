#!/usr/bin/env bash
# Builds and deploys the CareMap agent to a Lambda Function URL.
# Zip-based deploy via plain AWS CLI (no SAM/CDK/Terraform) -- this is a
# single-function hackathon project, so that's the simplest reliable path.
#
# Requires: AWS CLI configured (`aws configure`), GEMINI_API_KEY exported
# in your shell before running. Safe to re-run -- creates on first run,
# updates in place after that.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNCTION_NAME="caremap-agent"
ROLE_NAME="caremap-lambda-role"
REGION="$(aws configure get region)"
RUNTIME="python3.13"
# A fresh temp dir per run, outside the repo -- building in a reused
# .lambda-build/ inside the project meant `rm -rf` had to clear out whatever
# accumulated there (botocore alone ships tens of thousands of small files),
# which got slow and once produced a stuck multi-minute delete.
BUILD_DIR="$(mktemp -d /tmp/caremap-lambda-build.XXXXXX)"
ZIP_PATH="$(mktemp /tmp/caremap-lambda-build.XXXXXX.zip)"
trap 'rm -rf "$BUILD_DIR" "$ZIP_PATH"' EXIT
ALLOWED_ORIGINS="${CAREMAP_ALLOWED_ORIGINS:-http://localhost:5173}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
DEPLOY_BUCKET="caremap-lambda-deploy-$ACCOUNT_ID"
ZIP_KEY="caremap-agent.zip"

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "GEMINI_API_KEY is not set in this shell. Export it first:" >&2
  echo "  export GEMINI_API_KEY=..." >&2
  exit 1
fi

echo "==> Building deployment package in $BUILD_DIR"
rm -f "$ZIP_PATH"  # mktemp creates it empty; zip needs the path free

pip install --quiet \
  --target "$BUILD_DIR" \
  --platform manylinux2014_x86_64 \
  --only-binary=:all: \
  --python-version 3.13 \
  -r "$ROOT/requirements-lambda.txt"

cp -r "$ROOT/caremap" "$BUILD_DIR/caremap"
cp -r "$ROOT/policy" "$BUILD_DIR/policy"
mkdir -p "$BUILD_DIR/public/data"
cp -r "$ROOT/public/data/states" "$BUILD_DIR/public/data/states"
cp "$ROOT/public/data/zip_centroids.json" "$BUILD_DIR/public/data/zip_centroids.json"

find "$BUILD_DIR" -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true
find "$BUILD_DIR" -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

echo "==> Zipping ($(du -sh "$BUILD_DIR" | cut -f1) unzipped)"
(cd "$BUILD_DIR" && zip -q -r9 "$ZIP_PATH" .)
echo "    $(du -sh "$ZIP_PATH" | cut -f1) zipped"

echo "==> Uploading to s3://$DEPLOY_BUCKET/$ZIP_KEY (direct inline upload of a package this size is flaky over some networks)"
if ! aws s3api head-bucket --bucket "$DEPLOY_BUCKET" 2>/dev/null; then
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$DEPLOY_BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$DEPLOY_BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
fi
aws s3 cp "$ZIP_PATH" "s3://$DEPLOY_BUCKET/$ZIP_KEY" --quiet

echo "==> Ensuring IAM execution role $ROLE_NAME exists"
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]
    }' >/dev/null
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null
  echo "    created, waiting for IAM propagation..."
  sleep 10
fi
ROLE_ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)"

echo "==> Deploying function $FUNCTION_NAME ($REGION)"
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --s3-bucket "$DEPLOY_BUCKET" --s3-key "$ZIP_KEY" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --timeout 120 --memory-size 512 \
    --environment "Variables={GEMINI_API_KEY=$GEMINI_API_KEY,CAREMAP_ALLOWED_ORIGINS=$ALLOWED_ORIGINS}" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
else
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --runtime "$RUNTIME" \
    --role "$ROLE_ARN" \
    --handler caremap.lambda_handler.handler \
    --timeout 120 --memory-size 512 \
    --code "S3Bucket=$DEPLOY_BUCKET,S3Key=$ZIP_KEY" \
    --environment "Variables={GEMINI_API_KEY=$GEMINI_API_KEY,CAREMAP_ALLOWED_ORIGINS=$ALLOWED_ORIGINS}" >/dev/null
  aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
fi

echo "==> Ensuring Function URL exists (AuthType=NONE, public)"
if ! aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda create-function-url-config \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --auth-type NONE >/dev/null

  # Two separate grants are required -- InvokeFunctionUrl alone returns 403.
  aws lambda add-permission \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --statement-id FunctionURLAllowPublicAccess \
    --action lambda:InvokeFunctionUrl --principal '*' \
    --function-url-auth-type NONE >/dev/null
  aws lambda add-permission \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --statement-id FunctionURLInvokeAllowPublicAccess \
    --action lambda:InvokeFunction --principal '*' \
    --invoked-via-function-url >/dev/null
fi

FUNCTION_URL="$(aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" --query 'FunctionUrl' --output text)"

echo ""
echo "Deployed. Function URL:"
echo "  $FUNCTION_URL"
echo ""
echo "Set VITE_AGENT_URL=$FUNCTION_URL in .env to enable the chat enhancement."
