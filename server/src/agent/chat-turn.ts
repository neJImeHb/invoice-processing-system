export type ChatTurnEvent =
  | { readonly type: "token"; readonly text: string }
  | { readonly type: "tool_start"; readonly name: string; readonly arguments: unknown }
  | {
      readonly type: "tool_end";
      readonly name: string;
      readonly arguments: unknown;
      readonly result: unknown;
    }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string };

export interface ChatTurn {
  readonly message: string;
  readonly threadId: string;
  onEvent(event: ChatTurnEvent): void;
}

export interface ChatRunner {
  runTurn(turn: ChatTurn): Promise<void>;
}
