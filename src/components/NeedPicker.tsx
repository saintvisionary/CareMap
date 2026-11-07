import { CARE_NEEDS, NEED_CATEGORIES, needKind, needLabel } from "../lib/drg";
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
          <select
            value={isHospital ? need! : ""}
            onChange={(e) => onNeed(e.target.value || null)}
            aria-label="Condition or procedure"
            className="h-11 w-full appearance-none rounded-xl bg-white/[0.08] pl-3.5 pr-9 text-[15px] text-white outline-none focus:bg-white/[0.12] focus:ring-1 focus:ring-white/20"
          >
            <option value="">Choose a condition or procedure</option>
            {NEED_CATEGORIES.map((c) => (
              <optgroup key={c.category} label={c.category}>
                {c.items.map((n) => (
                  <option key={n} value={n}>
                    {needLabel(n)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDownIcon size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/45" />
          </div>
          <p className="mt-1.5 px-0.5 text-[12px] text-white/50">Prices are for a hospital stay, from Medicare's data for each hospital.</p>
        </div>
      )}
      {careNote && <p className="mt-2 px-0.5 text-[12px] text-white/55">{careNote}</p>}
    </div>
  );
}
