// The per-competition report (#117): registrations, entries, shortlisted,
// verified and certificates, split by route and age group, with fee totals.
// The report queries return grouped counts; this core turns them into the
// full table (every route × every age group, zero-filled, with route,
// age-group and grand totals) and into the typed rows the page and the CSV
// export both use, so the export always equals the screen.
//
// Only aggregate numbers and labels go in: no row here can carry personal
// data.
//
// Pure: no I/O, no "server-only".

/** How a registration was made, as `registration.route` holds it. */
export const REPORT_ROUTES = ["institution", "individual"] as const;

export type ReportRoute = (typeof REPORT_ROUTES)[number];

export const REPORT_METRICS = [
  "registrations",
  "entries",
  "shortlisted",
  "verified",
  "certificates",
] as const;

export type ReportMetric = (typeof REPORT_METRICS)[number];

/** Shortlisting happens in a school round, so individual entries have none. */
const NOT_APPLICABLE: Readonly<Record<ReportRoute, readonly ReportMetric[]>> = {
  institution: [],
  individual: ["shortlisted"],
};

function applies(metric: ReportMetric, route: ReportRoute): boolean {
  return !NOT_APPLICABLE[route].includes(metric);
}

/** One of the competition's age groups, ordered by `position`. */
export type ReportAgeGroup = { id: string; label: string; position: number };

/** One grouped count from the report queries. */
export type ReportCountRow = {
  metric: ReportMetric;
  route: ReportRoute;
  /** Null for a registration with no age group. */
  ageGroupId: string | null;
  count: number;
};

/** Fees for one route: captured payments and the refunds paid out of them. */
export type ReportFeeRow = {
  route: ReportRoute;
  currency: string;
  capturedMinor: bigint;
  refundedMinor: bigint;
};

/** A column of the split: an age group, or the bucket for counts with none. */
export type ReportColumn =
  | { kind: "age_group"; id: string; label: string }
  | { kind: "no_age_group" };

/** One count per metric; null where the metric doesn't apply. */
export type MetricValues = Record<ReportMetric, number | null>;

export type ReportLine =
  | {
      kind: "cell";
      route: ReportRoute;
      column: ReportColumn;
      values: MetricValues;
    }
  | { kind: "route_total"; route: ReportRoute; values: MetricValues }
  | { kind: "age_group_total"; column: ReportColumn; values: MetricValues }
  | { kind: "total"; values: MetricValues };

/** Amounts in paise. */
export type FeeTotals = {
  currency: "INR";
  capturedMinor: bigint;
  refundedMinor: bigint;
  netMinor: bigint;
};

export type CompetitionReport = {
  columns: ReportColumn[];
  /**
   * For each route: its cells in column order, then its total. Then one
   * total per column, then the grand total.
   */
  lines: ReportLine[];
  fees: { byRoute: Record<ReportRoute, FeeTotals>; total: FeeTotals };
};

const NO_AGE_GROUP = "\u0000no-age-group";

function columnKey(column: ReportColumn): string {
  return column.kind === "age_group" ? column.id : NO_AGE_GROUP;
}

function checkCount(row: ReportCountRow, ageGroupIds: Set<string>): void {
  if (!(REPORT_METRICS as readonly string[]).includes(row.metric)) {
    throw new RangeError(`Unknown report metric "${row.metric}"`);
  }
  if (!(REPORT_ROUTES as readonly string[]).includes(row.route)) {
    throw new RangeError(`Unknown registration route "${row.route}"`);
  }
  if (!Number.isSafeInteger(row.count) || row.count < 0) {
    throw new RangeError(
      `A ${row.metric} count must be a whole number of 0 or more, not ${row.count}`
    );
  }
  if (row.ageGroupId !== null && !ageGroupIds.has(row.ageGroupId)) {
    throw new RangeError(
      `Age group ${row.ageGroupId} isn't one of this competition's age groups`
    );
  }
  if (row.count > 0 && !applies(row.metric, row.route)) {
    throw new RangeError(
      `The ${row.route} route has no ${row.metric} count (got ${row.count})`
    );
  }
}

function emptyValues(applicable: (metric: ReportMetric) => boolean) {
  const values = {} as MetricValues;
  for (const metric of REPORT_METRICS) {
    values[metric] = applicable(metric) ? 0 : null;
  }
  return values;
}

function add(into: MetricValues, from: MetricValues): void {
  for (const metric of REPORT_METRICS) {
    const value = from[metric];
    if (value === null) continue;
    into[metric] = (into[metric] ?? 0) + value;
  }
}

function feeTotals(capturedMinor: bigint, refundedMinor: bigint): FeeTotals {
  return {
    currency: "INR",
    capturedMinor,
    refundedMinor,
    netMinor: capturedMinor - refundedMinor,
  };
}

function buildFees(fees: readonly ReportFeeRow[]): CompetitionReport["fees"] {
  const captured = new Map<ReportRoute, bigint>();
  const refunded = new Map<ReportRoute, bigint>();
  for (const row of fees) {
    if (!(REPORT_ROUTES as readonly string[]).includes(row.route)) {
      throw new RangeError(`Unknown registration route "${row.route}"`);
    }
    if (row.currency !== "INR") {
      throw new RangeError(`Fees are in INR only, not ${row.currency}`);
    }
    if (row.capturedMinor < 0n || row.refundedMinor < 0n) {
      throw new RangeError("Fee amounts can't be negative");
    }
    captured.set(
      row.route,
      (captured.get(row.route) ?? 0n) + row.capturedMinor
    );
    refunded.set(
      row.route,
      (refunded.get(row.route) ?? 0n) + row.refundedMinor
    );
  }
  const byRoute = {} as Record<ReportRoute, FeeTotals>;
  let totalCaptured = 0n;
  let totalRefunded = 0n;
  for (const route of REPORT_ROUTES) {
    const routeCaptured = captured.get(route) ?? 0n;
    const routeRefunded = refunded.get(route) ?? 0n;
    byRoute[route] = feeTotals(routeCaptured, routeRefunded);
    totalCaptured += routeCaptured;
    totalRefunded += routeRefunded;
  }
  return { byRoute, total: feeTotals(totalCaptured, totalRefunded) };
}

/**
 * Builds the full report from grouped counts and fee rows. Rows repeating a
 * route, age group and metric are added up. A count for an age group the
 * competition doesn't have, a shortlisted count on the individual route,
 * a count that isn't a whole number of 0 or more, or a fee that isn't INR
 * means the queries are wrong, so it throws rather than show a wrong total.
 */
export function buildCompetitionReport(input: {
  ageGroups: readonly ReportAgeGroup[];
  counts: readonly ReportCountRow[];
  fees: readonly ReportFeeRow[];
}): CompetitionReport {
  const ageGroupIds = new Set<string>();
  for (const group of input.ageGroups) {
    if (ageGroupIds.has(group.id)) {
      throw new RangeError(`Age group ${group.id} is listed twice`);
    }
    ageGroupIds.add(group.id);
  }
  for (const row of input.counts) checkCount(row, ageGroupIds);

  const columns: ReportColumn[] = [...input.ageGroups]
    .sort((a, b) => a.position - b.position)
    .map(({ id, label }) => ({ kind: "age_group", id, label }));
  if (input.counts.some((row) => row.ageGroupId === null && row.count > 0)) {
    columns.push({ kind: "no_age_group" });
  }

  const counted = new Map<string, number>();
  const cellKey = (route: ReportRoute, key: string, metric: ReportMetric) =>
    `${route}|${key}|${metric}`;
  for (const row of input.counts) {
    const key = cellKey(row.route, row.ageGroupId ?? NO_AGE_GROUP, row.metric);
    counted.set(key, (counted.get(key) ?? 0) + row.count);
  }

  const lines: ReportLine[] = [];
  const columnTotals = new Map<string, MetricValues>(
    columns.map((column) => [
      columnKey(column),
      emptyValues((metric) =>
        REPORT_ROUTES.some((route) => applies(metric, route))
      ),
    ])
  );
  const total = emptyValues((metric) =>
    REPORT_ROUTES.some((route) => applies(metric, route))
  );

  for (const route of REPORT_ROUTES) {
    const routeTotal = emptyValues((metric) => applies(metric, route));
    for (const column of columns) {
      const values = emptyValues((metric) => applies(metric, route));
      for (const metric of REPORT_METRICS) {
        if (values[metric] === null) continue;
        values[metric] =
          counted.get(cellKey(route, columnKey(column), metric)) ?? 0;
      }
      lines.push({ kind: "cell", route, column, values });
      add(routeTotal, values);
      add(columnTotals.get(columnKey(column))!, values);
    }
    lines.push({ kind: "route_total", route, values: routeTotal });
    add(total, routeTotal);
  }
  for (const column of columns) {
    lines.push({
      kind: "age_group_total",
      column,
      values: columnTotals.get(columnKey(column))!,
    });
  }
  lines.push({ kind: "total", values: total });

  return { columns, lines, fees: buildFees(input.fees) };
}

/** One cell of the report table, typed so the CSV writer and the page each format it. */
export type ReportCell =
  | { kind: "text"; value: string }
  | { kind: "count"; value: number }
  | { kind: "amount"; minor: bigint; currency: "INR" }
  /** The metric doesn't apply here (shortlisted on the individual route). */
  | { kind: "not_applicable" }
  /** Nothing belongs here (fees on a line that isn't a route or grand total). */
  | { kind: "empty" };

/** Every word the table shows, from the `adminReports` messages. */
export type ReportLabels = {
  routeHeader: string;
  ageGroupHeader: string;
  metric: Record<ReportMetric, string>;
  fees: { captured: string; refunded: string; net: string };
  route: Record<ReportRoute, string>;
  allRoutes: string;
  allAgeGroups: string;
  noAgeGroup: string;
};

const NO_FEES: ReportCell[] = [
  { kind: "empty" },
  { kind: "empty" },
  { kind: "empty" },
];

function feeCells(fees: FeeTotals): ReportCell[] {
  return [fees.capturedMinor, fees.refundedMinor, fees.netMinor].map(
    (minor) => ({ kind: "amount", minor, currency: fees.currency })
  );
}

function metricCells(values: MetricValues): ReportCell[] {
  return REPORT_METRICS.map((metric) => {
    const value = values[metric];
    return value === null
      ? { kind: "not_applicable" }
      : { kind: "count", value };
  });
}

/**
 * The report as one rectangular table: route, age group, the five metrics
 * and the three fee columns. Fees aren't split by age group, so they sit on
 * the route totals and the grand total only.
 */
export function reportTable(
  report: CompetitionReport,
  labels: ReportLabels
): { header: ReportCell[]; rows: ReportCell[][] } {
  const text = (value: string): ReportCell => ({ kind: "text", value });
  const columnLabel = (column: ReportColumn) =>
    text(column.kind === "age_group" ? column.label : labels.noAgeGroup);

  const header = [
    labels.routeHeader,
    labels.ageGroupHeader,
    ...REPORT_METRICS.map((metric) => labels.metric[metric]),
    labels.fees.captured,
    labels.fees.refunded,
    labels.fees.net,
  ].map(text);

  const rows = report.lines.map((line): ReportCell[] => {
    switch (line.kind) {
      case "cell":
        return [
          text(labels.route[line.route]),
          columnLabel(line.column),
          ...metricCells(line.values),
          ...NO_FEES,
        ];
      case "route_total":
        return [
          text(labels.route[line.route]),
          text(labels.allAgeGroups),
          ...metricCells(line.values),
          ...feeCells(report.fees.byRoute[line.route]),
        ];
      case "age_group_total":
        return [
          text(labels.allRoutes),
          columnLabel(line.column),
          ...metricCells(line.values),
          ...NO_FEES,
        ];
      case "total":
        return [
          text(labels.allRoutes),
          text(labels.allAgeGroups),
          ...metricCells(line.values),
          ...feeCells(report.fees.total),
        ];
    }
  });

  return { header, rows };
}
