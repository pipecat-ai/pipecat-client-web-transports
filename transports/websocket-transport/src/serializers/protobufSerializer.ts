import { Frame } from "../generated/proto/frames";
import {
  DeserializedData,
  WebSocketSerializer,
} from "./websocketSerializer.ts";
import { logger, RTVIMessage } from "@pipecat-ai/client-js";

export class ProtobufFrameSerializer implements WebSocketSerializer {
  serialize(data: any): any {}
  serializeAudio(
    data: ArrayBuffer,
    sampleRate: number,
    numChannels: number
  ): Uint8Array {
    const pcmByteArray = new Uint8Array(data);
    const frame = Frame.create({
      frame: {
        oneofKind: "audio",
        audio: {
          id: 0n,
          name: "audio",
          audio: pcmByteArray,
          sampleRate: sampleRate,
          numChannels: numChannels,
        },
      },
    });
    return new Uint8Array(Frame.toBinary(frame));
  }
  serializeMessage(msg: RTVIMessage): Uint8Array {
    const frame = Frame.create({
      frame: {
        oneofKind: "message",
        message: {
          data: JSON.stringify(msg),
        },
      },
    });
    return new Uint8Array(Frame.toBinary(frame));
  }
  async deserialize(data: any): Promise<DeserializedData> {
    if (!(data instanceof Blob)) {
      throw new Error("Unknown data type");
    }
    const arrayBuffer = await data.arrayBuffer();
    const parsed = Frame.fromBinary(new Uint8Array(arrayBuffer)).frame;
    if (parsed.oneofKind === "audio") {
      const audioVector = Array.from(parsed.audio.audio);
      const uint8Array = new Uint8Array(audioVector);
      const int16Array = new Int16Array(uint8Array.buffer);
      return { type: "audio", audio: int16Array };
    } else if (parsed.oneofKind === "message") {
      const msg = JSON.parse(parsed.message.data);
      return { type: "message", message: msg };
    } else if (parsed.oneofKind === "interruption") {
      return { type: "interruption" };
    } else if (parsed.oneofKind === undefined) {
      logger.warn("Ignoring frame of unknown kind");
    } else {
      logger.warn(`Ignoring unsupported frame kind: ${parsed.oneofKind}`);
    }
    return { type: "raw", message: parsed };
  }
}
