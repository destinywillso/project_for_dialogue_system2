import { assign, createActor,  setup, fromPromise} from "xstate";
import { speechstate } from "speechstate";
import type { Settings } from "speechstate";
import type { DMEvents, DMContext, Message,ContradictionOutput, ContradictionInput} from "./types";
import { KEY } from "./azure";

const azureCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: "northeurope",
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
};

const dmMachine = setup({
  types: {
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    sst_prepare: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
    sst_listen: ({ context }) => context.spstRef.send({ type: "LISTEN" }),
  },
  actors:{
    getModels: fromPromise<any,null>(() => 
      fetch("http://localhost:11434/api/tags").then((response) =>
        response.json()
      )
    ),
    modelReply : fromPromise<any, Message[]> (({input}) => {
      const body = {
        model: "llama3:latest",
        stream: false,
        messages: input,
        temperature : 0.8,
      };
      return fetch("http://localhost:11434/api/chat", {
        method: "POST",
        body: JSON.stringify(body),
      }).then((response) => response.json());
    }
    ) ,
contradictionModel: fromPromise<ContradictionOutput, ContradictionInput>(async ({ input }) => {
  console.log("=== Fetching contradiction ===");
  console.log("Input:", input);

  try {
    const response = await fetch("http://127.0.0.1:8000/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    console.log("HTTP status:", response.status);

    const data = await response.json();
    console.log("Response data:", data);

    if (!data || (data.prediction !== "contradiction" && data.prediction !== "no_contradiction")) {
      console.error("Invalid ContradictionOutput:", data);
      throw new Error("Returned object is not a valid ContradictionOutput");
    }

    console.log("Contradiction resolved with:", data);
    return data as ContradictionOutput;
  } catch (err) {
    console.error("Contradiction fetch failed:", err);
    throw err; 
  }
}),



},
}).createMachine({
  id: "DM",
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    informationState: { latestMove: "ping" },
    lastResult: "",
    messages:[],
    ollamaModels:[],
    lastContradiction: null,
  }),
  initial: "Prepare",
  states: {
    Prepare: {
      entry: "sst_prepare",
      on: {
        ASRTTS_READY: "GetModels",
      },
    },
    GetModels:{
      invoke:{
        src:"getModels",
        input: null,
        onDone:{
          target: "Main",
          actions: assign(({ event }) => {
              return {
              ollamaModels:event.output.models.map((x:any) => x.name)
            }
          })
        }
      },
    },
    Main: {
      initial: "Prompt",
      states:{
        Prompt: { 
          entry: assign(({ context }) => ({
            messages: [
              {
                role: "system",
                content: `Hello!`
              },
              ...context.messages
            ]
          })),
          on:{
            CLICK : "SpeakPrompt"
          }
        },
      
      SpeakPrompt: {
        entry: ({ context }) =>
          context.spstRef.send({
            type: "SPEAK",
            value: { utterance: context.messages[0].content },
          }),
        on: { SPEAK_COMPLETE: "Ask" }
      },

      Ask: {
        entry: "sst_listen",
        on: {
          LISTEN_COMPLETE:{
            target:"CheckContradiction"
          },
          RECOGNISED: {
            actions: assign(({ event, context }) => ({
              messages: [
                ...context.messages,               
                { role: "user", content: event.value[0].utterance },
              ],
            })),
          },
          ASR_NOINPUT: {
            target: "CheckContradiction",
            actions: assign(({ context }) => ({
              messages: [
                ...context.messages,
                { role: "user", content: "" },
              ],
            })),
          },
        },
      },

      CheckContradiction: {
        invoke: {
            src: "contradictionModel",
            input: ({ context }): ContradictionInput => {
                const userMessages = context.messages.filter(m => m.role === "user");
                const recentMessages = userMessages.slice(-2); 
                
                const utterances = recentMessages.map(m => {
                    const text = m.content.trim();
                    return text.endsWith('.') ? text : text + '.';
                });
                console.log("=== Contradiction Input ===");
                console.log("Recent user messages:", recentMessages);
                console.log("Utterances array:", utterances);

                return {
                    utterances,
                    annotation_target_pair: [
                        0,
                        recentMessages.length - 1,
                    ],
                };
            },
            onDone: { 
                target: "#DM.Main.ChatCompletion",
                actions: assign(({ event }) => ({
                    lastContradiction: event.output.prediction,
                })),
            },
            onError: { 
                target: "#DM.Main.ChatCompletion",
                actions: ({ event }) => console.error(" onError triggered:", event.error),
            },
        },
      },

      ChatCompletion: {
        invoke: {
          src: "modelReply",
          input: (context) => {
            const messagesForLLM: Message[] = [
              {
                role: "system",
                content: context.context.lastContradiction
                  ? `Note: The last user message is classified as ${context.context.lastContradiction}.`
                  : "You are a helpful assistant.",
              },
              ...context.context.messages,
            ];
            return messagesForLLM;
          },
          onDone: {
            target: "Speaking",
            actions: assign(({ event, context }) => ({
              messages: [
                ...context.messages,
                { role: "assistant", content: event.output.message.content },
              ],
            })),
          },
        },
      },

      Speaking: {
        entry: ({ context }) => {
          const msgs = context.messages;
          const lastMsg = msgs[msgs.length - 1]; 
          if (lastMsg && lastMsg.role === "assistant") {
            context.spstRef.send({
              type: "SPEAK",
              value: { utterance: lastMsg.content },
            });
          }
        },
        on: { SPEAK_COMPLETE: "Ask" },
      },

      Done: {
        type: "final",
        entry: () => {
          console.log("Conversation finished.");
  }
}


      },
    },
  },
});

const dmActor = createActor(dmMachine, {}).start();

dmActor.subscribe((state) => {
  console.group("State update");
  console.log("State value:", state.value);
  console.log("State context:", state.context);
  console.groupEnd();
});

export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta()
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}
