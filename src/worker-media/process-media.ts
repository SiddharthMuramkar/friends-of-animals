import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  MediaError,
  type MediaErrorCode,
  type MediaProcessor,
  type MediaResult,
} from "../server/ports/media";

export type MediaProcessReply =
  | { result: MediaResult }
  | { code: MediaErrorCode };

/** A hard deadline covers WASM decode and every derivative, including native sharp code. */
export function processMediaInChild(timeoutSeconds: number): MediaProcessor {
  return {
    processImage(input) {
      return new Promise((resolve, reject) => {
        const child = fork(
          fileURLToPath(new URL("./image-job.ts", import.meta.url)),
          [],
          {
            // Decoding needs file bytes and libraries, with no service configuration.
            env: { NODE_ENV: "production" },
            execArgv: ["--import", "tsx"],
            serialization: "advanced",
            stdio: ["ignore", "ignore", "ignore", "ipc"],
          }
        );

        let reply: MediaProcessReply | undefined;
        let failure: Error | undefined;
        const deadline = setTimeout(() => {
          failure = new MediaError("media_timeout");
          child.kill("SIGKILL");
        }, timeoutSeconds * 1000);

        child.once("message", (message: MediaProcessReply) => {
          reply = message;
        });
        child.once("error", (error) => {
          failure ??= error;
        });
        child.once("close", () => {
          clearTimeout(deadline);
          if (failure) reject(failure);
          else if (!reply)
            reject(new Error("The image process exited without a result"));
          else if ("code" in reply) reject(new MediaError(reply.code));
          else resolve(reply.result);
        });
        child.send(input, (error) => {
          if (!error) return;
          failure ??= error;
          child.kill("SIGKILL");
        });
      });
    },
  };
}
