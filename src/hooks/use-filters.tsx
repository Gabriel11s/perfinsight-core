import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { DateRange } from "@/types";
import { startOfDay, endOfDay, subDays } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { useSettings } from "@/hooks/use-settings";

interface FiltersContextValue {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  locationFilter: string | null;
  setLocationFilter: (id: string | null) => void;
  userFilter: string | null;
  setUserFilter: (id: string | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  preset: string;
  setPreset: (p: string) => void;
  timezone: string;
}

/**
 * Compute a date range in the user's configured timezone.
 *
 * How it works:
 * 1. `toZonedTime(now, tz)` gives us a Date whose UTC fields represent
 *    the wall-clock time in `tz`. e.g. for UTC-3, 03:00 UTC → 00:00.
 * 2. `startOfDay` / `endOfDay` operate on those shifted fields.
 * 3. `fromZonedTime(shifted, tz)` converts back to a real UTC instant.
 *
 * This ensures "today" means the calendar day in the user's timezone,
 * regardless of the browser's local timezone.
 */
function buildRange(preset: string, tz: string): DateRange {
  const nowInTz = toZonedTime(new Date(), tz);
  switch (preset) {
    case "1d":
      return {
        from: fromZonedTime(startOfDay(nowInTz), tz),
        to: fromZonedTime(endOfDay(nowInTz), tz),
      };
    case "7d":
      return {
        from: fromZonedTime(startOfDay(subDays(nowInTz, 7)), tz),
        to: fromZonedTime(endOfDay(nowInTz), tz),
      };
    case "30d":
      return {
        from: fromZonedTime(startOfDay(subDays(nowInTz, 30)), tz),
        to: fromZonedTime(endOfDay(nowInTz), tz),
      };
    default:
      return {
        from: fromZonedTime(startOfDay(subDays(nowInTz, 7)), tz),
        to: fromZonedTime(endOfDay(nowInTz), tz),
      };
  }
}

const FiltersContext = createContext<FiltersContextValue>(
  {} as FiltersContextValue,
);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useSettings();
  const tz = settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [dateRange, setDateRange] = useState<DateRange>(() => buildRange("7d", tz));
  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [preset, setPreset] = useState("7d");

  // Re-compute range when the timezone setting loads / changes
  useEffect(() => {
    setDateRange(buildRange(preset, tz));
  }, [tz]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePreset = (p: string) => {
    setPreset(p);
    setDateRange(buildRange(p, tz));
  };

  return (
    <FiltersContext.Provider
      value={{
        dateRange,
        setDateRange,
        locationFilter,
        setLocationFilter,
        userFilter,
        setUserFilter,
        searchQuery,
        setSearchQuery,
        preset,
        setPreset: handlePreset,
        timezone: tz,
      }}
    >
      {children}
    </FiltersContext.Provider>
  );
}

export const useFilters = () => useContext(FiltersContext);
