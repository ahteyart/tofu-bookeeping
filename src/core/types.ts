export type DocKind = 'invoice' | 'receipt' | 'bank_statement';
export type DocStatus =
  | 'received' | 'extracted' | 'coded' | 'needs_review'
  | 'approved' | 'posted' | 'failed' | 'rejected';

export interface Firm { id: string; name: string; plan: 'starter' | 'pro'; }
export interface User {
  id: string; firmId: string; email: string; role: 'admin' | 'accountant' | 'reviewer';
  /** scrypt hash as `salt:hash` (hex); absent = cannot log in */
  passwordHash?: string;
}
export interface Session { token: string; userId: string; expiresAt: number; }
export interface Client {
  id: string; firmId: string; name: string; baseCurrency: string;
  /** docs at or above this combined confidence skip human review */
  autoApproveThreshold: number;
}

export interface Account { id: string; code: string; name: string; type: string; }
export interface TaxRate { id: string; name: string; rate: number; }
export interface Contact { id: string; name: string; }
/** Per-client cache of what the ledger told us (Module 2). */
export interface LedgerCache { accounts: Account[]; taxRates: TaxRate[]; contacts: Contact[]; syncedAt: string; }

export interface Document {
  id: string; clientId: string; kind: DocKind; filename: string;
  sha256: string; /** OCR'd / plain text content */ content: string;
  status: DocStatus; autoApproved: boolean; createdAt: string; error?: string;
  /** set for uploaded PDFs/images; `content` is then empty and the bytes live in the file store */
  mediaType?: string; filePath?: string;
}
export interface ExtractedLine { description: string; qty: number; unitPrice: number; amount: number; }
export interface Extraction {
  documentId: string; supplier: string; docNumber: string; docDate: string;
  currency: string; total: number; taxTotal: number; lines: ExtractedLine[]; confidence: number;
}
export interface BankLine {
  id: string; clientId: string; documentId: string; date: string;
  description: string; amount: number; matchedPostingId?: string;
}

export interface LineCoding { accountId?: string; taxRateId?: string; confidence: number; source: 'rule' | 'learned' | 'history' | 'none'; }
export interface Coding {
  documentId: string; contactId?: string; contactConfidence: number;
  lines: LineCoding[]; confidence: number;
}
export interface CodingRule {
  id: string; clientId: string; supplierMatch: string; /** lowercase substring */
  accountId: string; taxRateId?: string; source: 'manual' | 'learned';
}
export interface Feedback {
  id: string; documentId: string; clientId: string; supplier: string;
  accountId: string; taxRateId?: string; corrected: boolean; userId: string; at: string;
}

export interface ReviewItem {
  id: string; documentId: string; clientId: string; reasons: string[];
  status: 'open' | 'resolved'; resolvedBy?: string;
}
export interface Posting {
  id: string; documentId: string; clientId: string; idempotencyKey: string;
  status: 'pending' | 'posted' | 'failed'; externalId?: string; error?: string;
  attempts: number; total: number; docDate: string; supplier: string; postedAt?: string;
}
export interface AuditEntry { id: string; at: string; actor: string; action: string; entity: string; entityId: string; detail?: unknown; }
export interface UsageRecord { firmId: string; period: string; docs: number; }
