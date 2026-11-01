import type { Kafka } from "kafkajs";
import type { DependencyProbe } from "../app.js";

export function kafkaProbe(kafka: Kafka): DependencyProbe {
  return {
    async check(): Promise<boolean> {
      const admin = kafka.admin();
      try {
        await admin.connect();
        await admin.listTopics();
        return true;
      } finally {
        await admin.disconnect();
      }
    },
  };
}
