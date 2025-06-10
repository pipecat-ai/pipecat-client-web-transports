import { RTVIMessage } from "@pipecat-ai/client-js";

export interface WebSocketSerializer {
  serialize(data: any): any;
  serializeAudio(
    data: ArrayBuffer,
    sampleRate: number,
    numChannels: number,
  ): any;
  serializeMessage(msg: RTVIMessage): any;
  deserialize(data: any): Promise<
    | { type: "audio"; audio: Int16Array }
    | { type: "message"; message: RTVIMessage }
    | { type: "raw"; message: any } // Including any other message that we are not aware of
  >;
}
