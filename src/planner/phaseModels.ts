export type MenstrualPhase = "menstrual" | "follicular" | "ovulation" | "luteal";

export type MoonPhase =
  | "new"
  | "waxing_crescent"
  | "first_quarter"
  | "waxing_gibbous"
  | "full"
  | "waning_gibbous"
  | "last_quarter"
  | "waning_crescent";

export type IlluminationBucket = "low" | "medium" | "high";

export interface MenstrualPhaseParams {
  cycleDay: number;
  cycleLength?: number;
  lutealLength?: number;
}

export interface MenstrualPhaseResult {
  phase: MenstrualPhase;
  dayInPhase: number;
  ovulationDay: number;
}

export interface MoonPhaseResult {
  moonPhase: MoonPhase;
  moonAgeDays: number;
  illuminationBucket: IlluminationBucket;
}

export interface PlannerUserProfile {
  cycleStartDate: string;
  cycleLength: number;
  lutealLength?: number;
}

export interface PhaseContext {
  dateISO: string;
  cycleDay: number;
  menstrualPhase: MenstrualPhase;
  dayInPhase: number;
  moonPhase: MoonPhase;
  moonAgeDays: number;
}
