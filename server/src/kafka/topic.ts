import type { Admin, Kafka } from "kafkajs";

export const INVOICE_JOBS_TOPIC = "invoice-jobs";

export async function ensureInvoiceTopic(kafka: Kafka): Promise<void> {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const topics = await admin.listTopics();
    if (topics.includes(INVOICE_JOBS_TOPIC)) {
      return;
    }
    await createInvoiceTopic(admin);
  } finally {
    await admin.disconnect();
  }
}

async function createInvoiceTopic(admin: Admin): Promise<void> {
  try {
    await admin.createTopics({
      topics: [
        {
          topic: INVOICE_JOBS_TOPIC,
          numPartitions: 3,
          replicationFactor: 1,
        },
      ],
    });
  } catch (error) {
    if (isTopicAlreadyExists(error)) {
      return;
    }
    throw error;
  }
}

function isTopicAlreadyExists(error: unknown): boolean {
  const text = errorText(error);
  return text.includes("TOPIC_ALREADY_EXISTS") || text.includes("already exists");
}

function errorText(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }
  if ("type" in error && error.type === "TOPIC_ALREADY_EXISTS") {
    return "TOPIC_ALREADY_EXISTS";
  }
  if ("message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "";
}
