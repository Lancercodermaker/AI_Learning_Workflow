import { PipelineError } from '../../domain/errors';
import type { AsrWorkerCue, AsrWorkerFailure, AsrWorkerResponse, AsrWorkerSuccess } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function protocolError(message: string, cause?: unknown): PipelineError {
  return new PipelineError('transcript', 'ASR_PROTOCOL_INVALID', message, false, cause);
}

function parseCue(value: unknown): AsrWorkerCue | null {
  if (!isRecord(value)) return null;
  const start = value.start;
  const end = value.end;
  const text = value.text;
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) return null;
  if (typeof end !== 'number' || !Number.isFinite(end) || end <= start) return null;
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  const confidence = value.confidence;
  if (confidence !== undefined && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) return null;
  return {
    start,
    end,
    text: text.trim(),
    source: 'asr',
    ...(confidence === undefined ? {} : { confidence }),
  };
}

function parseSuccess(value: Record<string, unknown>, expectedId: string): AsrWorkerSuccess {
  if (value.id !== expectedId || value.ok !== true || typeof value.language !== 'string' || value.language.trim().length === 0 || !Array.isArray(value.cues)) {
    throw protocolError('ASR worker success response had an invalid shape');
  }
  const cues = value.cues.map(parseCue);
  if (cues.some((cue) => cue === null)) throw protocolError('ASR worker returned an invalid cue');
  return { id: expectedId, ok: true, language: value.language, cues: cues as AsrWorkerCue[] };
}

function parseFailure(value: Record<string, unknown>, expectedId: string): AsrWorkerFailure {
  if (value.id !== expectedId || value.ok !== false || typeof value.code !== 'string' || value.code.trim().length === 0 || typeof value.message !== 'string' || value.message.trim().length === 0) {
    throw protocolError('ASR worker failure response had an invalid shape');
  }
  return { id: expectedId, ok: false, code: value.code, message: value.message };
}

export function parseAsrWorkerLine(line: string, expectedId: string): AsrWorkerResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error: unknown) {
    throw protocolError('ASR worker returned malformed JSON', error);
  }
  if (!isRecord(parsed)) throw protocolError('ASR worker returned a non-object response');
  if (parsed.id !== expectedId) throw protocolError('ASR worker response id did not match the request');
  if (parsed.ok === true) return parseSuccess(parsed, expectedId);
  if (parsed.ok === false) return parseFailure(parsed, expectedId);
  throw protocolError('ASR worker response omitted its success flag');
}
