"use client";

// Voice messages for reminders, recorded (or picked) on this device and kept in
// its IndexedDB: a sound is too big for the sheet. A WhatsApp link can't carry a
// sound, so it is handed to WhatsApp through the phone's share menu; a PC that
// can't share files downloads it instead, to drop into the chat.

import { idbGet, idbSet } from "./idb";

export interface ReminderAudio {
  id: string;
  name: string;
  blob: Blob;
  createdAt: string;
}

const KEY = "reminder-audios";
/** A voice note longer than this is not a reminder (and phones keep it small). */
export const MAX_AUDIO_BYTES = 3_000_000;

export async function listAudios(): Promise<ReminderAudio[]> {
  const list = await idbGet<ReminderAudio[]>(KEY);
  return Array.isArray(list) ? list.filter((a) => a && a.blob instanceof Blob) : [];
}

export async function saveAudio(name: string, blob: Blob): Promise<ReminderAudio[]> {
  const list = await listAudios();
  const next = [...list, { id: Math.random().toString(36).slice(2, 10), name: name.trim() || "رسالة صوتية", blob, createdAt: new Date().toISOString() }];
  await idbSet(KEY, next);
  return next;
}

export async function deleteAudio(id: string): Promise<ReminderAudio[]> {
  const next = (await listAudios()).filter((a) => a.id !== id);
  await idbSet(KEY, next);
  return next;
}

/** The best recording format this browser has; WhatsApp plays Ogg/Opus as a voice note. */
export function recordingType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4", "audio/webm"]) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {}
  }
  return "";
}

function extension(type: string): string {
  return type.includes("ogg") ? "ogg" : type.includes("mp4") || type.includes("m4a") ? "m4a" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : "webm";
}

/**
 * Hand the voice note to WhatsApp: the share menu where the browser can share
 * files (phones), else a download. Says which happened ("cancelled" when closed).
 */
export async function shareAudio(audio: ReminderAudio, fileName: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([audio.blob], `${fileName}.${extension(audio.blob.type)}`, { type: audio.blob.type || "audio/ogg" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return "shared";
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "downloaded";
}
