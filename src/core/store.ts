import { randomUUID } from 'node:crypto';
import type {
  AuditEntry, BankLine, Client, Coding, CodingRule, Document, Extraction, Feedback,
  Firm, LedgerCache, Posting, ReviewItem, Session, UsageRecord, User,
} from './types.ts';

export const newId = (): string => randomUUID();
export const now = (): string => new Date().toISOString();

/** In-memory persistence. Swap for Postgres (see db/schema.sql) without touching modules. */
export class Store {
  firms = new Map<string, Firm>();
  users = new Map<string, User>();
  clients = new Map<string, Client>();
  ledgerCache = new Map<string, LedgerCache>();
  documents = new Map<string, Document>();
  extractions = new Map<string, Extraction>();
  codings = new Map<string, Coding>();
  rules = new Map<string, CodingRule>();
  feedback: Feedback[] = [];
  reviewItems = new Map<string, ReviewItem>();
  postings = new Map<string, Posting>();
  bankLines = new Map<string, BankLine>();
  audit: AuditEntry[] = [];
  sessions = new Map<string, Session>();
  loginFails = new Map<string, { n: number; until: number }>();
  usage = new Map<string, UsageRecord>();
}

export function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`${what} not found`);
  return v;
}
