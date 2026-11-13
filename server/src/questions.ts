import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Question } from '@ws-quiz/shared';

const questionsDir = join(__dirname, '..', '..', 'questions');

export function loadQuestions(): Map<string, Map<string, Question>> {
  const files = readdirSync(questionsDir)
    .filter(filename => filename.endsWith('.json') && filename !== 'index.json')
    .sort((a, b) => a.localeCompare(b));
  return new Map(files.map(filename => {
    const raw = readFileSync(join(questionsDir, filename), 'utf-8');
    const list = JSON.parse(raw) as Question[];
    const questions = new Map(list.map(q => [q.id, q]));
    if (questions.size !== list.length) {
      throw new Error(`Duplicate question ID in ${filename}`);
    }
    return [filename, questions];
  }));
}
