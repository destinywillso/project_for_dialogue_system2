import type { SpeechStateExternalEvent } from "speechstate";
import type { AnyActorRef } from "xstate";

export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: string;
  informationState: { latestMove: string };
  messages: Message[];
  ollamaModels: String[];
  lastContradiction?: "contradiction" | "no_contradiction" | null;
}

export type DMEvents =
  | SpeechStateExternalEvent
  | { type: "CLICK" }
  | { type: "SAYS"; value: string }
  | { type: "NEXT_MOVE"; value: string }
  | { type: "DONE" };

export type Message = {
  role: "assistant" | "user" | "system";
  content: string;
}

export interface ContradictionInput {
  utterances: string[];
  annotation_target_pair?: number[];
}

export interface ContradictionOutput {
  prediction: "contradiction" | "no_contradiction";
}