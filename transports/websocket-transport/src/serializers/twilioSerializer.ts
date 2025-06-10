import { WebSocketSerializer } from "./websocketSerializer.ts";
import { RTVIMessage } from "@pipecat-ai/client-js";

export class TwilioSerializer implements WebSocketSerializer {
  serialize(data: any): string {
    return JSON.stringify(data);
  }

  // μ-law encoder helper
  private linearToMuLawSample(sample: number): number {
    const MULAW_MAX = 0x1fff;
    const MULAW_BIAS = 33;
    let sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;
    if (sample > MULAW_MAX) sample = MULAW_MAX;
    sample = sample + MULAW_BIAS;
    let exponent = 7;
    for (
      let expMask = 0x4000;
      (sample & expMask) === 0 && exponent > 0;
      expMask >>= 1
    ) {
      exponent--;
    }
    let mantissa = (sample >> (exponent + 3)) & 0x0f;
    let muLawByte = ~(sign | (exponent << 4) | mantissa);
    return muLawByte & 0xff;
  }

  serializeAudio(
    data: ArrayBuffer,
    sampleRate: number,
    numChannels: number,
  ): string {
    // Step 1: Resampling is assumed done externally or sampleRate = 8000Hz

    // Convert ArrayBuffer to Int16Array
    const pcmSamples = new Int16Array(data);

    // Convert each PCM sample to μ-law byte
    const muLawSamples = new Uint8Array(pcmSamples.length);
    for (let i = 0; i < pcmSamples.length; i++) {
      muLawSamples[i] = this.linearToMuLawSample(pcmSamples[i]);
    }

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

  async deserialize(
    data: any,
  ): Promise<
    | { type: "audio"; audio: Int16Array }
    | { type: "message"; message: RTVIMessage }
    | { type: "raw"; message: any }
  > {
    const jsonMessage = JSON.parse(data); // Assuming 'data' is a JSON string

    console.log("Received json", jsonMessage);

    if (jsonMessage.event === "clear") {
      return {
        type: "raw",
        message: jsonMessage,
      };
    } else if (jsonMessage.event === "media") {
      // Deserialize 'media' event
      const payload = jsonMessage.media.payload;
      const serialized_data = Buffer.from(payload, "base64");

      // Implement your PCM to μ-law decoding (if necessary)
      // Example: const decoded_audio = await ulaw_to_pcm(serialized_data);

      // Assuming you decode to Int16Array, modify as per your decoding logic
      const decoded_audio: Int16Array = new Int16Array(serialized_data.buffer);

      return { type: "audio", audio: decoded_audio };
    } else {
      // Deserialize other message types (assuming 'frame' has 'message' field)
      return { type: "message", message: jsonMessage.message };
    }
  }
}
