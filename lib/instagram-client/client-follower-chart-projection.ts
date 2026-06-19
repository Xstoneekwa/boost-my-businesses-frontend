import type {
  ClientFollowerGrowthSeries,
  FollowerGrowthPeriod,
} from "./client-follower-growth-projection";

export type FollowerChartPeriod = FollowerGrowthPeriod;

export type FollowerChartView = {
  title: string;
  mainValue: string;
  deltaDisplay: string | null;
  deltaTone: "positive" | "negative" | "neutral" | "unknown";
  subtitle: string;
  showChart: boolean;
  points: Array<{ capturedAt: string; followersCount: number; businessDayKey: string }>;
  coverageStatus: ClientFollowerGrowthSeries["coverageStatus"];
};

function dash(lang: "fr" | "en") {
  return "—";
}

function formatCount(value: number, lang: "fr" | "en") {
  return new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US").format(value);
}

function formatSignedDelta(value: number, lang: "fr" | "en") {
  const formatted = formatCount(Math.abs(value), lang);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return "0";
}

function formatHistoryDate(value: string, lang: "fr" | "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function resolveSubtitle(series: ClientFollowerGrowthSeries, lang: "fr" | "en") {
  if (series.coverageStatus === "none") {
    return lang === "fr"
      ? "Première lecture des abonnés en cours"
      : "First follower reading in progress";
  }
  if (series.coverageStatus === "baseline_only") {
    return lang === "fr"
      ? "Historique des abonnés en cours de collecte"
      : "Follower history collection in progress";
  }
  if (series.period === "daily" && series.points.length < 2) {
    return lang === "fr"
      ? "Lecture intrajournalière en cours de collecte"
      : "Intraday follower readings collection in progress";
  }
  if (series.coverageStatus === "partial" && series.historyStartDate) {
    return lang === "fr"
      ? `Historique disponible depuis le ${formatHistoryDate(series.historyStartDate, lang)}`
      : `History available since ${formatHistoryDate(series.historyStartDate, lang)}`;
  }
  return "";
}

function resolveDeltaDisplay(series: ClientFollowerGrowthSeries, lang: "fr" | "en") {
  if (series.deltaStatus === "unknown" || series.delta === null) return dash(lang);
  return formatSignedDelta(series.delta, lang);
}

function resolveDeltaTone(series: ClientFollowerGrowthSeries): FollowerChartView["deltaTone"] {
  if (series.deltaStatus === "unknown" || series.delta === null) return "unknown";
  if (series.deltaStatus === "zero") return "neutral";
  if (series.deltaStatus === "positive") return "positive";
  return "negative";
}

export function buildFollowerChartTitle(username: string | null, lang: "fr" | "en") {
  const handle = username?.replace(/^@+/, "") || (lang === "fr" ? "compte" : "account");
  return `${lang === "fr" ? "Abonnés" : "Followers"} · @${handle}`;
}

export function buildFollowerChartView(
  series: ClientFollowerGrowthSeries,
  lang: "fr" | "en",
): FollowerChartView {
  const empty = dash(lang);
  const mainValue = series.currentFollowers === null ? empty : formatCount(series.currentFollowers, lang);
  const deltaDisplay = series.coverageStatus === "none" ? empty : resolveDeltaDisplay(series, lang);
  const showChart = series.points.length >= 2;

  return {
    title: "",
    mainValue,
    deltaDisplay: series.coverageStatus === "none" ? empty : deltaDisplay,
    deltaTone: resolveDeltaTone(series),
    subtitle: resolveSubtitle(series, lang),
    showChart,
    points: series.points,
    coverageStatus: series.coverageStatus,
  };
}

export function buildFollowerChartViews(
  bundle: {
    all: ClientFollowerGrowthSeries;
    d30: ClientFollowerGrowthSeries;
    daily: ClientFollowerGrowthSeries;
  },
  lang: "fr" | "en",
) {
  return {
    all: buildFollowerChartView(bundle.all, lang),
    "30d": buildFollowerChartView(bundle.d30, lang),
    daily: buildFollowerChartView(bundle.daily, lang),
  } as Record<FollowerChartPeriod, FollowerChartView>;
}
