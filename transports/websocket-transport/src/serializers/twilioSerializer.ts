import { WebSocketSerializer } from "./websocketSerializer.ts";
import { RTVIMessage } from "@pipecat-ai/client-js";
import { mulaw } from "x-law";

export class TwilioSerializer implements WebSocketSerializer {
  serialize(data: any): string {
    return JSON.stringify(data);
  }

  serializeAudio(
    data: ArrayBuffer,
    sampleRate: number,
    numChannels: number,
  ): string {
    const pcmSamples = new Int16Array(data);
    const muLawSamples = mulaw.encode(pcmSamples);
    const base64Payload = this.arrayToBase64(muLawSamples);
    const twilioMessage = {
      event: "media",
      media: {
        payload: base64Payload,
      },
    };
    return JSON.stringify(twilioMessage);
  }

  serializeMessage(msg: RTVIMessage): any {
    // Twilio does not support RTVI messages, so just ignore them
    return null;
  }

  private arrayToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  async deserialize(
    data: any,
  ): Promise<
    | { type: "audio"; audio: Int16Array }
    | { type: "message"; message: RTVIMessage }
    | { type: "raw"; message: any }
  > {
    const jsonMessage = JSON.parse(data); // Assuming 'data' is a JSON string
    if (jsonMessage.event === "clear") {
      return {
        type: "raw",
        message: jsonMessage,
      };
    } else if (jsonMessage.event === "media") {
      // Deserialize 'media' event
      const payload = jsonMessage.media.payload;
      const serialized_data = this.base64ToUint8Array(payload);
      //const decoded_audio = this.ulawToPcm(serialized_data);
      const decoded_audio = mulaw.decode(serialized_data);

      return { type: "audio", audio: decoded_audio };
    } else {
      // Deserialize other message types (assuming 'frame' has 'message' field)
      return { type: "message", message: jsonMessage.message };
    }
  }
}
