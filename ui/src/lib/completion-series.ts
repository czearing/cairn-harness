export interface CompletionEvent {
  agentId: string;
  completedAt: string;
}

export interface SeriesPoint {
  day: string;
  total: number;
}

export interface AgentSeries {
  agentId: string;
  total: number;
  points: SeriesPoint[];
}

export interface CompletionSeries {
  days: string[];
  agents: AgentSeries[];
  total: number;
}

// Constructing an Intl.DateTimeFormat is orders of magnitude more expensive than using one, and this runs
// once per completion, so formatters are cached per zone. Building one per event cost 7.6s at 50k events.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone?: string): Intl.DateTimeFormat {
  const key = timeZone || "";
  const cached = formatters.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  formatters.set(key, created);
  return created;
}

// A day key in the viewer's local zone. Completion timestamps are written by several runtimes in several
// shapes (Z, +00:00, and offsets with nanosecond precision), so they are parsed rather than sliced: taking
// the first ten characters of a UTC string buckets a 19:00 local completion into the following day.
export function dayKey(value: string, timeZone?: string): string | undefined {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  const date = new Date(parsed);
  // Without an explicit zone the answer is simply the viewer's own local date, and the platform's local
  // getters produce it far more cheaply than a formatter. Intl is reserved for a caller-supplied zone.
  if (!timeZone) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  return formatterFor(timeZone).format(date);
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return next.toISOString().slice(0, 10);
}

// Cumulative totals must be defined on every day in the range, including days an agent completed nothing,
// or the line would jump straight between distant points and imply work that never happened. Each agent
// therefore carries its previous total forward, which also keeps every series monotonic by construction.
export function completionSeries(events: CompletionEvent[], timeZone?: string): CompletionSeries {
  const perAgent = new Map<string, Map<string, number>>();
  for (const event of events) {
    const day = dayKey(event.completedAt, timeZone);
    if (!day || !event.agentId) continue;
    const days = perAgent.get(event.agentId) || new Map<string, number>();
    days.set(day, (days.get(day) || 0) + 1);
    perAgent.set(event.agentId, days);
  }
  const observed = [...perAgent.values()].flatMap((days) => [...days.keys()]).sort();
  if (!observed.length) return { days: [], agents: [], total: 0 };
  const days: string[] = [];
  for (let day = observed[0]; day <= observed[observed.length - 1]; day = nextDay(day)) days.push(day);
  const agents = [...perAgent.entries()]
    .map(([agentId, counts]) => {
      let running = 0;
      const points = days.map((day) => {
        running += counts.get(day) || 0;
        return { day, total: running };
      });
      return { agentId, total: running, points };
    })
    .sort((a, b) => b.total - a.total || a.agentId.localeCompare(b.agentId));
  return { days, agents, total: agents.reduce((sum, agent) => sum + agent.total, 0) };
}
