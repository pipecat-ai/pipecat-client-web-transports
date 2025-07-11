// @generated by protobuf-ts 2.11.0 with parameter generate_dependencies
// @generated from protobuf file "proto/frames.proto" (package "pipecat", syntax proto3)
// tslint:disable
//
//
// Copyright (c) 2024–2025, Daily
//
// SPDX-License-Identifier: BSD 2-Clause License
//
//
//
// Generate frames_pb2.py with:
//
//   python -m grpc_tools.protoc --proto_path=./ --python_out=./protobufs frames.proto
//
import type { BinaryWriteOptions } from "@protobuf-ts/runtime";
import type { IBinaryWriter } from "@protobuf-ts/runtime";
import { WireType } from "@protobuf-ts/runtime";
import type { BinaryReadOptions } from "@protobuf-ts/runtime";
import type { IBinaryReader } from "@protobuf-ts/runtime";
import { UnknownFieldHandler } from "@protobuf-ts/runtime";
import type { PartialMessage } from "@protobuf-ts/runtime";
import { reflectionMergePartial } from "@protobuf-ts/runtime";
import { MessageType } from "@protobuf-ts/runtime";
/**
 * @generated from protobuf message pipecat.TextFrame
 */
export interface TextFrame {
    /**
     * @generated from protobuf field: uint64 id = 1
     */
    id: bigint;
    /**
     * @generated from protobuf field: string name = 2
     */
    name: string;
    /**
     * @generated from protobuf field: string text = 3
     */
    text: string;
}
/**
 * @generated from protobuf message pipecat.AudioRawFrame
 */
export interface AudioRawFrame {
    /**
     * @generated from protobuf field: uint64 id = 1
     */
    id: bigint;
    /**
     * @generated from protobuf field: string name = 2
     */
    name: string;
    /**
     * @generated from protobuf field: bytes audio = 3
     */
    audio: Uint8Array;
    /**
     * @generated from protobuf field: uint32 sample_rate = 4
     */
    sampleRate: number;
    /**
     * @generated from protobuf field: uint32 num_channels = 5
     */
    numChannels: number;
    /**
     * @generated from protobuf field: optional uint64 pts = 6
     */
    pts?: bigint;
}
/**
 * @generated from protobuf message pipecat.TranscriptionFrame
 */
export interface TranscriptionFrame {
    /**
     * @generated from protobuf field: uint64 id = 1
     */
    id: bigint;
    /**
     * @generated from protobuf field: string name = 2
     */
    name: string;
    /**
     * @generated from protobuf field: string text = 3
     */
    text: string;
    /**
     * @generated from protobuf field: string user_id = 4
     */
    userId: string;
    /**
     * @generated from protobuf field: string timestamp = 5
     */
    timestamp: string;
}
/**
 * @generated from protobuf message pipecat.MessageFrame
 */
export interface MessageFrame {
    /**
     * @generated from protobuf field: string data = 1
     */
    data: string;
}
/**
 * @generated from protobuf message pipecat.Frame
 */
export interface Frame {
    /**
     * @generated from protobuf oneof: frame
     */
    frame: {
        oneofKind: "text";
        /**
         * @generated from protobuf field: pipecat.TextFrame text = 1
         */
        text: TextFrame;
    } | {
        oneofKind: "audio";
        /**
         * @generated from protobuf field: pipecat.AudioRawFrame audio = 2
         */
        audio: AudioRawFrame;
    } | {
        oneofKind: "transcription";
        /**
         * @generated from protobuf field: pipecat.TranscriptionFrame transcription = 3
         */
        transcription: TranscriptionFrame;
    } | {
        oneofKind: "message";
        /**
         * @generated from protobuf field: pipecat.MessageFrame message = 4
         */
        message: MessageFrame;
    } | {
        oneofKind: undefined;
    };
}
// @generated message type with reflection information, may provide speed optimized methods
class TextFrame$Type extends MessageType<TextFrame> {
    constructor() {
        super("pipecat.TextFrame", [
            { no: 1, name: "id", kind: "scalar", T: 4 /*ScalarType.UINT64*/, L: 0 /*LongType.BIGINT*/ },
            { no: 2, name: "name", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
            { no: 3, name: "text", kind: "scalar", T: 9 /*ScalarType.STRING*/ }
        ]);
    }
    create(value?: PartialMessage<TextFrame>): TextFrame {
        const message = globalThis.Object.create((this.messagePrototype!));
        message.id = 0n;
        message.name = "";
        message.text = "";
        if (value !== undefined)
            reflectionMergePartial<TextFrame>(this, message, value);
        return message;
    }
    internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: TextFrame): TextFrame {
        let message = target ?? this.create(), end = reader.pos + length;
        while (reader.pos < end) {
            let [fieldNo, wireType] = reader.tag();
            switch (fieldNo) {
                case /* uint64 id */ 1:
                    message.id = reader.uint64().toBigInt();
                    break;
                case /* string name */ 2:
                    message.name = reader.string();
                    break;
                case /* string text */ 3:
                    message.text = reader.string();
                    break;
                default:
                    let u = options.readUnknownField;
                    if (u === "throw")
                        throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
                    let d = reader.skip(wireType);
                    if (u !== false)
                        (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
            }
        }
        return message;
    }
    internalBinaryWrite(message: TextFrame, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
        /* uint64 id = 1; */
        if (message.id !== 0n)
            writer.tag(1, WireType.Varint).uint64(message.id);
        /* string name = 2; */
        if (message.name !== "")
            writer.tag(2, WireType.LengthDelimited).string(message.name);
        /* string text = 3; */
        if (message.text !== "")
            writer.tag(3, WireType.LengthDelimited).string(message.text);
        let u = options.writeUnknownFields;
        if (u !== false)
            (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
        return writer;
    }
}
/**
 * @generated MessageType for protobuf message pipecat.TextFrame
 */
export const TextFrame = new TextFrame$Type();
// @generated message type with reflection information, may provide speed optimized methods
class AudioRawFrame$Type extends MessageType<AudioRawFrame> {
    constructor() {
        super("pipecat.AudioRawFrame", [
            { no: 1, name: "id", kind: "scalar", T: 4 /*ScalarType.UINT64*/, L: 0 /*LongType.BIGINT*/ },
            { no: 2, name: "name", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
            { no: 3, name: "audio", kind: "scalar", T: 12 /*ScalarType.BYTES*/ },
            { no: 4, name: "sample_rate", kind: "scalar", T: 13 /*ScalarType.UINT32*/ },
            { no: 5, name: "num_channels", kind: "scalar", T: 13 /*ScalarType.UINT32*/ },
            { no: 6, name: "pts", kind: "scalar", opt: true, T: 4 /*ScalarType.UINT64*/, L: 0 /*LongType.BIGINT*/ }
        ]);
    }
    create(value?: PartialMessage<AudioRawFrame>): AudioRawFrame {
        const message = globalThis.Object.create((this.messagePrototype!));
        message.id = 0n;
        message.name = "";
        message.audio = new Uint8Array(0);
        message.sampleRate = 0;
        message.numChannels = 0;
        if (value !== undefined)
            reflectionMergePartial<AudioRawFrame>(this, message, value);
        return message;
    }
    internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: AudioRawFrame): AudioRawFrame {
        let message = target ?? this.create(), end = reader.pos + length;
        while (reader.pos < end) {
            let [fieldNo, wireType] = reader.tag();
            switch (fieldNo) {
                case /* uint64 id */ 1:
                    message.id = reader.uint64().toBigInt();
                    break;
                case /* string name */ 2:
                    message.name = reader.string();
                    break;
                case /* bytes audio */ 3:
                    message.audio = reader.bytes();
                    break;
                case /* uint32 sample_rate */ 4:
                    message.sampleRate = reader.uint32();
                    break;
                case /* uint32 num_channels */ 5:
                    message.numChannels = reader.uint32();
                    break;
                case /* optional uint64 pts */ 6:
                    message.pts = reader.uint64().toBigInt();
                    break;
                default:
                    let u = options.readUnknownField;
                    if (u === "throw")
                        throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
                    let d = reader.skip(wireType);
                    if (u !== false)
                        (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
            }
        }
        return message;
    }
    internalBinaryWrite(message: AudioRawFrame, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
        /* uint64 id = 1; */
        if (message.id !== 0n)
            writer.tag(1, WireType.Varint).uint64(message.id);
        /* string name = 2; */
        if (message.name !== "")
            writer.tag(2, WireType.LengthDelimited).string(message.name);
        /* bytes audio = 3; */
        if (message.audio.length)
            writer.tag(3, WireType.LengthDelimited).bytes(message.audio);
        /* uint32 sample_rate = 4; */
        if (message.sampleRate !== 0)
            writer.tag(4, WireType.Varint).uint32(message.sampleRate);
        /* uint32 num_channels = 5; */
        if (message.numChannels !== 0)
            writer.tag(5, WireType.Varint).uint32(message.numChannels);
        /* optional uint64 pts = 6; */
        if (message.pts !== undefined)
            writer.tag(6, WireType.Varint).uint64(message.pts);
        let u = options.writeUnknownFields;
        if (u !== false)
            (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
        return writer;
    }
}
/**
 * @generated MessageType for protobuf message pipecat.AudioRawFrame
 */
export const AudioRawFrame = new AudioRawFrame$Type();
// @generated message type with reflection information, may provide speed optimized methods
class TranscriptionFrame$Type extends MessageType<TranscriptionFrame> {
    constructor() {
        super("pipecat.TranscriptionFrame", [
            { no: 1, name: "id", kind: "scalar", T: 4 /*ScalarType.UINT64*/, L: 0 /*LongType.BIGINT*/ },
            { no: 2, name: "name", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
            { no: 3, name: "text", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
            { no: 4, name: "user_id", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
            { no: 5, name: "timestamp", kind: "scalar", T: 9 /*ScalarType.STRING*/ }
        ]);
    }
    create(value?: PartialMessage<TranscriptionFrame>): TranscriptionFrame {
        const message = globalThis.Object.create((this.messagePrototype!));
        message.id = 0n;
        message.name = "";
        message.text = "";
        message.userId = "";
        message.timestamp = "";
        if (value !== undefined)
            reflectionMergePartial<TranscriptionFrame>(this, message, value);
        return message;
    }
    internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: TranscriptionFrame): TranscriptionFrame {
        let message = target ?? this.create(), end = reader.pos + length;
        while (reader.pos < end) {
            let [fieldNo, wireType] = reader.tag();
            switch (fieldNo) {
                case /* uint64 id */ 1:
                    message.id = reader.uint64().toBigInt();
                    break;
                case /* string name */ 2:
                    message.name = reader.string();
                    break;
                case /* string text */ 3:
                    message.text = reader.string();
                    break;
                case /* string user_id */ 4:
                    message.userId = reader.string();
                    break;
                case /* string timestamp */ 5:
                    message.timestamp = reader.string();
                    break;
                default:
                    let u = options.readUnknownField;
                    if (u === "throw")
                        throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
                    let d = reader.skip(wireType);
                    if (u !== false)
                        (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
            }
        }
        return message;
    }
    internalBinaryWrite(message: TranscriptionFrame, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
        /* uint64 id = 1; */
        if (message.id !== 0n)
            writer.tag(1, WireType.Varint).uint64(message.id);
        /* string name = 2; */
        if (message.name !== "")
            writer.tag(2, WireType.LengthDelimited).string(message.name);
        /* string text = 3; */
        if (message.text !== "")
            writer.tag(3, WireType.LengthDelimited).string(message.text);
        /* string user_id = 4; */
        if (message.userId !== "")
            writer.tag(4, WireType.LengthDelimited).string(message.userId);
        /* string timestamp = 5; */
        if (message.timestamp !== "")
            writer.tag(5, WireType.LengthDelimited).string(message.timestamp);
        let u = options.writeUnknownFields;
        if (u !== false)
            (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
        return writer;
    }
}
/**
 * @generated MessageType for protobuf message pipecat.TranscriptionFrame
 */
export const TranscriptionFrame = new TranscriptionFrame$Type();
// @generated message type with reflection information, may provide speed optimized methods
class MessageFrame$Type extends MessageType<MessageFrame> {
    constructor() {
        super("pipecat.MessageFrame", [
            { no: 1, name: "data", kind: "scalar", T: 9 /*ScalarType.STRING*/ }
        ]);
    }
    create(value?: PartialMessage<MessageFrame>): MessageFrame {
        const message = globalThis.Object.create((this.messagePrototype!));
        message.data = "";
        if (value !== undefined)
            reflectionMergePartial<MessageFrame>(this, message, value);
        return message;
    }
    internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: MessageFrame): MessageFrame {
        let message = target ?? this.create(), end = reader.pos + length;
        while (reader.pos < end) {
            let [fieldNo, wireType] = reader.tag();
            switch (fieldNo) {
                case /* string data */ 1:
                    message.data = reader.string();
                    break;
                default:
                    let u = options.readUnknownField;
                    if (u === "throw")
                        throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
                    let d = reader.skip(wireType);
                    if (u !== false)
                        (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
            }
        }
        return message;
    }
    internalBinaryWrite(message: MessageFrame, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
        /* string data = 1; */
        if (message.data !== "")
            writer.tag(1, WireType.LengthDelimited).string(message.data);
        let u = options.writeUnknownFields;
        if (u !== false)
            (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
        return writer;
    }
}
/**
 * @generated MessageType for protobuf message pipecat.MessageFrame
 */
export const MessageFrame = new MessageFrame$Type();
// @generated message type with reflection information, may provide speed optimized methods
class Frame$Type extends MessageType<Frame> {
    constructor() {
        super("pipecat.Frame", [
            { no: 1, name: "text", kind: "message", oneof: "frame", T: () => TextFrame },
            { no: 2, name: "audio", kind: "message", oneof: "frame", T: () => AudioRawFrame },
            { no: 3, name: "transcription", kind: "message", oneof: "frame", T: () => TranscriptionFrame },
            { no: 4, name: "message", kind: "message", oneof: "frame", T: () => MessageFrame }
        ]);
    }
    create(value?: PartialMessage<Frame>): Frame {
        const message = globalThis.Object.create((this.messagePrototype!));
        message.frame = { oneofKind: undefined };
        if (value !== undefined)
            reflectionMergePartial<Frame>(this, message, value);
        return message;
    }
    internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: Frame): Frame {
        let message = target ?? this.create(), end = reader.pos + length;
        while (reader.pos < end) {
            let [fieldNo, wireType] = reader.tag();
            switch (fieldNo) {
                case /* pipecat.TextFrame text */ 1:
                    message.frame = {
                        oneofKind: "text",
                        text: TextFrame.internalBinaryRead(reader, reader.uint32(), options, (message.frame as any).text)
                    };
                    break;
                case /* pipecat.AudioRawFrame audio */ 2:
                    message.frame = {
                        oneofKind: "audio",
                        audio: AudioRawFrame.internalBinaryRead(reader, reader.uint32(), options, (message.frame as any).audio)
                    };
                    break;
                case /* pipecat.TranscriptionFrame transcription */ 3:
                    message.frame = {
                        oneofKind: "transcription",
                        transcription: TranscriptionFrame.internalBinaryRead(reader, reader.uint32(), options, (message.frame as any).transcription)
                    };
                    break;
                case /* pipecat.MessageFrame message */ 4:
                    message.frame = {
                        oneofKind: "message",
                        message: MessageFrame.internalBinaryRead(reader, reader.uint32(), options, (message.frame as any).message)
                    };
                    break;
                default:
                    let u = options.readUnknownField;
                    if (u === "throw")
                        throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
                    let d = reader.skip(wireType);
                    if (u !== false)
                        (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
            }
        }
        return message;
    }
    internalBinaryWrite(message: Frame, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
        /* pipecat.TextFrame text = 1; */
        if (message.frame.oneofKind === "text")
            TextFrame.internalBinaryWrite(message.frame.text, writer.tag(1, WireType.LengthDelimited).fork(), options).join();
        /* pipecat.AudioRawFrame audio = 2; */
        if (message.frame.oneofKind === "audio")
            AudioRawFrame.internalBinaryWrite(message.frame.audio, writer.tag(2, WireType.LengthDelimited).fork(), options).join();
        /* pipecat.TranscriptionFrame transcription = 3; */
        if (message.frame.oneofKind === "transcription")
            TranscriptionFrame.internalBinaryWrite(message.frame.transcription, writer.tag(3, WireType.LengthDelimited).fork(), options).join();
        /* pipecat.MessageFrame message = 4; */
        if (message.frame.oneofKind === "message")
            MessageFrame.internalBinaryWrite(message.frame.message, writer.tag(4, WireType.LengthDelimited).fork(), options).join();
        let u = options.writeUnknownFields;
        if (u !== false)
            (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
        return writer;
    }
}
/**
 * @generated MessageType for protobuf message pipecat.Frame
 */
export const Frame = new Frame$Type();
