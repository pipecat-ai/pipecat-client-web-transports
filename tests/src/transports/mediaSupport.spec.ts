/**
 * What transports report they can carry, combined with what their media
 * manager can capture.
 */

import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { describe, expect, test } from "vitest";

import { createFakeMediaManager } from "../helpers/fakeMediaManager";

function mediaManagerCapturing(mediaSupport?: object) {
  const mediaManager = createFakeMediaManager();
  if (mediaSupport) mediaManager.mediaSupport = mediaSupport;
  return mediaManager;
}

describe("SmallWebRTCTransport.mediaSupport", () => {
  test("is what the media manager can capture, plus the bot's audio and video", () => {
    const transport = new SmallWebRTCTransport({
      mediaManager: mediaManagerCapturing({
        mic: true,
        cam: false,
        screenShare: false,
      }) as never,
    });
    expect(transport.mediaSupport).toEqual({
      mic: true,
      cam: false,
      screenShare: false,
      botAudio: true,
      botVideo: true,
    });
  });

  test("leaves capture unknown for a media manager that doesn't declare it", () => {
    const transport = new SmallWebRTCTransport({
      mediaManager: mediaManagerCapturing() as never,
    });
    expect(transport.mediaSupport).toEqual({ botAudio: true, botVideo: true });
  });
});
