import { useEffect, useState } from "react";
import { fetchHealth, HEALTH_POLL_INTERVAL_MS, postgresHealthLabel, redpandaHealthLabel, type HealthReport } from "../api/health";

export function HealthBadge() {
  const report = useHealthReport();
  if (report === undefined) {
    return <p>Checking health…</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
      <span>{postgresHealthLabel(report.postgres)}</span>
      <span>{redpandaHealthLabel(report.kafka)}</span>
    </p>
  );
}

function useHealthReport(): HealthReport | undefined {
  const [report, setReport] = useState<HealthReport | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const poll = (): void => {
      fetchHealth()
        .then((next) => {
          if (active) {
            setReport(next);
          }
        })
        .catch((error: unknown) => {
          console.error(error);
          if (active) {
            setReport({ postgres: false, kafka: false });
          }
        });
    };
    poll();
    const timer = setInterval(poll, HEALTH_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return report;
}
