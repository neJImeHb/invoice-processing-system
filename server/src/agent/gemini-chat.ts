import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { AppEnv } from "../config/env.js";

export function createGeminiChatModel(env: Pick<AppEnv, "GEMINI_API_KEY" | "GEMINI_MODEL">): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    model: env.GEMINI_MODEL,
    apiKey: env.GEMINI_API_KEY,
  });
}
