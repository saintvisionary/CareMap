import { CARE_NEEDS, NEED_CATEGORIES, needKind, needLabel } from "../lib/drg";
import { t } from "../i18n";
import { Menu } from "./Menu";
import { ChevronDownIcon } from "./icons";
import { chip, chipOff, chipOn, label } from "./ui";

interface NeedPickerProps {
  need: string | null;
  onNeed: (need: string | null) => void;
  hospitalOpen: boolean;
  onHospitalOpen: (open: boolean) => void;
}

/** Everyday care first, as one-tap chips; hospital conditions and
 * procedures behind one more chip. Tapping the selected chip clears it. */
export function NeedPicker({ need, onNeed, hospitalOpen, onHospitalOpen }: NeedPickerProps) {
  const isHospital = needKind(need) === "hospital";
  const showHospital = hospitalOpen || isHospital;
  const careNote = CARE_NEEDS.find((n) => n.need === need)?.note;

  return (
    <div>
      <span className={label}>What do you need?</span>
      <div className="flex flex-wrap gap-1.5">
        {CARE_NEEDS.map((n) => (
          <button
            key={n.need}
            type="button"
            aria-pressed={need === n.need}
            onClick={() => {
              onHospitalOpen(false);
              onNeed(need === n.need ? null : n.need);
            }}
            className={`${chip} ${need === n.need ? chipOn : chipOff}`}
          >
            {n.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={showHospital}
          onClick={() => {
            if (showHospital) {
              onHospitalOpen(false);
              if (isHospital) onNeed(null);
            } else {
              onHospitalOpen(true);
              if (need) onNeed(null);
            }
          }}
          className={`${chip} ${showHospital ? chipOn : chipOff} gap-1`}
        >
          Hospital care
          <ChevronDownIcon size={14} className={`transition-transform duration-200 ${showHospital ? "rotate-180" : ""}`} />
        </button>
      </div>

      {showHospital && (
        <div className="mt-2.5">
          <div className="relative">
          <Menu
            value={isHospital ? need! : ""}
            onChange={(v) => onNeed(v || null)}
            groups={NEED_CATEGORIES.map((c) => ({ label: t(c.category), options: c.items.map((n) => ({ value: n, label: t(needLabel(n)) })) }))}
            searchable
            placeholder={t("Choose a condition or procedure")}
            ariaLabel={t("Condition or procedure")}
          />
          </div>
          <p className="mt-1.5 px-0.5 text-[12px] text-white/50">Prices are for a hospital stay, from Medicare's data for each hospital.</p>
        </div>
      )}
      {careNote && <p className="mt-2 px-0.5 text-[12px] text-white/55">{careNote}</p>}
    </div>
  );
}
