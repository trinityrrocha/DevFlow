const { z } = require('zod');

const MAX_CODE_BYTES = 200000;
const GITHUB_CODE_LANGUAGES = [
  'plaintext', 'pascal', 'javascript', 'typescript', 'sql', 'python', 'json',
  'html', 'css', 'scss', 'xml', 'markdown', 'shell', 'powershell', 'php',
  'java', 'c', 'cpp', 'csharp', 'yaml', 'go', 'ruby', 'rust'
];

const optionalUrl = z.preprocess((value) => value === '' ? null : value, z.string().url().nullable().optional());
const codeContent = z.string()
  .refine((value) => value.trim().length > 0, 'Informe o codigo da anotacao.')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_CODE_BYTES, 'O codigo excede o limite de 200 KB.');

const githubFields = {
  title: z.string().trim().min(2).max(160).optional(),
  repository_url: optionalUrl,
  branch: z.string().trim().max(255).nullable().optional(),
  commit_sha: z.string().trim().max(64).nullable().optional(),
  pull_request_url: optionalUrl,
  release: z.string().trim().max(255).nullable().optional(),
  notes_code: z.string().max(50000).nullable().optional(),
  file_name: z.string().trim().max(500).nullable().optional(),
  language: z.enum(GITHUB_CODE_LANGUAGES),
  code_content: codeContent,
  explanation: z.string().max(50000).nullable().optional()
};

const createGithubCardSchema = z.object(githubFields).strict();
const updateGithubCardSchema = z.object({
  ...githubFields,
  language: githubFields.language.optional(),
  code_content: githubFields.code_content.optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo.');

module.exports = { MAX_CODE_BYTES, GITHUB_CODE_LANGUAGES, createGithubCardSchema, updateGithubCardSchema };
