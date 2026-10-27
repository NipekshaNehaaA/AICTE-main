import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { ah, audit, HttpError } from '../http.ts';
import { getOrBuildHandbookIndex, type HandbookIndex } from '../copilot/indexer.ts';
import { BM25Engine } from '../copilot/bm25.ts';
import { synthesizeCopilotResponse, type ApplicantContext } from '../copilot/synthesizer.ts';

let cachedIndex: HandbookIndex | null = null;
let cachedEngine: BM25Engine | null = null;

async function getEngine(): Promise<BM25Engine> {
  if (!cachedEngine || !cachedIndex) {
    cachedIndex = await getOrBuildHandbookIndex();
    cachedEngine = new BM25Engine(cachedIndex.chunks);
  }
  return cachedEngine;
}

const QuerySchema = z.object({
  query: z.string().min(2, 'Query must be at least 2 characters').max(1000, 'Query exceeds 1000 characters'),
  context: z
    .object({
      currentPath: z.string().optional(),
      applicationId: z.string().optional(),
    })
    .optional(),
});

export function copilotRouter(db: Db): Router {
  const r = Router();

  r.get(
    '/status',
    ah(async (_req: Request, res: Response) => {
      await getEngine();
      res.json({
        ok: true,
        version: cachedIndex?.version || 'APH 2024-27',
        totalPages: cachedIndex?.totalPages || 231,
        totalChunks: cachedIndex?.totalChunks || 0,
        indexedAt: cachedIndex?.indexedAt,
      });
    }),
  );

  r.post(
    '/query',
    ah(async (req: Request, res: Response) => {
      const user = req.user;
      if (!user) {
        throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required.');
      }

      // Role authorization: Only institutional applicants
      const isApplicant =
        user.activeRole === 'INSTITUTION_APPLICANT' ||
        (user.roles && user.roles.includes('INSTITUTION_APPLICANT'));

      if (!isApplicant) {
        throw new HttpError(
          403,
          'FORBIDDEN',
          'Only institutional applicants are authorized to access the AICTE Approval Process Copilot.',
        );
      }

      const parsed = QuerySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, 'BAD_REQUEST', parsed.error.issues[0]?.message || 'Invalid query format');
      }

      const { query } = parsed.data;
      const engine = await getEngine();

      // Scoped institution context
      const institutionId = user.institutionIds?.[0] || null;
      let applicantContext: ApplicantContext | null = null;

      if (institutionId) {
        const inst = await db.one<{ name: string }>(
          'SELECT name FROM institutions WHERE id = $1',
          [institutionId],
        );

        const app = await db.one<{
          reference_no: string | null;
          status: string;
          category_code: string;
          subtype: string | null;
          submitted_at: string | null;
        }>(
          'SELECT reference_no, status, category_code, subtype, submitted_at FROM applications WHERE institution_id = $1 ORDER BY created_at DESC LIMIT 1',
          [institutionId],
        );

        let deficiencies: any[] = [];
        if (app && app.reference_no) {
          deficiencies = await db.query(
            `SELECT d.reference_no, d.target_label, d.category, d.explanation, d.corrective_action, d.deadline, d.status
               FROM deficiencies d
               JOIN applications a ON a.id = d.application_id
              WHERE a.institution_id = $1 AND d.status != 'RESOLVED'
              ORDER BY d.raised_at DESC`,
            [institutionId],
          );
        }

        applicantContext = {
          institutionName: inst?.name || 'Institution',
          application: app
            ? {
                referenceNo: app.reference_no,
                status: app.status,
                categoryCode: app.category_code,
                subtype: app.subtype,
                submittedAt: app.submitted_at,
              }
            : null,
          deficiencies: deficiencies.map(d => ({
            referenceNo: d.reference_no,
            targetLabel: d.target_label,
            category: d.category,
            explanation: d.explanation,
            correctiveAction: d.corrective_action,
            deadline: d.deadline,
            status: d.status,
          })),
        };
      }

      // BM25 Search
      const searchResults = engine.search(query, 3, 5.5);

      // Synthesize Answer
      const response = synthesizeCopilotResponse(query, searchResults, applicantContext);

      // Audit Logging
      await audit(
        db,
        req,
        'COPILOT_QUERY',
        'copilot',
        null,
        {
          query,
          matchedClauses: searchResults.map(r => ({ clause: r.chunk.clause, score: r.score })),
          hasApplicationContext: Boolean(applicantContext?.application),
        },
        institutionId,
      );

      res.json(response);
    }),
  );

  r.get(
    '/clause/:clauseId',
    ah(async (req: Request, res: Response) => {
      await getEngine();
      const clauseId = req.params.clauseId;
      const chunk = cachedIndex?.chunks.find(
        c => c.id === clauseId || c.clause.toLowerCase() === clauseId.toLowerCase(),
      );

      if (!chunk) {
        throw new HttpError(404, 'NOT_FOUND', `Clause ${clauseId} not found in Approval Process Handbook.`);
      }

      res.json(chunk);
    }),
  );

  return r;
}
