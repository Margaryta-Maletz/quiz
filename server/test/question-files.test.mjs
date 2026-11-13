import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { handleMessage } from '../src/handlers.ts';
import { GameSession } from '../src/session.ts';
import { loadQuestions } from '../src/questions.ts';

function socket() {
  const messages = [];
  return {
    messages,
    readyState: WebSocket.OPEN,
    send(data) { messages.push(JSON.parse(data)); },
  };
}

function dispatch(ws, ctx, msg) {
  handleMessage(ws, Buffer.from(JSON.stringify(msg)), ctx);
}

test('questions are loaded by file at startup', () => {
  const files = loadQuestions();
  assert.ok(files.get('week-09.json')?.size);
  assert.ok(files.get('week-10.json')?.size);
  assert.ok(files.get('week-10-async.json')?.size);
});

test('start, reconnect, grading and preview use the selected file even with duplicate IDs', () => {
  const host = socket();
  const student = socket();
  const present = socket();
  const session = new GameSession();
  const questions = new Map([
    ['first.json', new Map([['same', { id: 'same', code: 'first', type: 'input', answers: ['first answer'] }]])],
    ['second.json', new Map([['same', { id: 'same', code: 'second', type: 'multiple', options: ['A', 'B', 'C'], answers: ['A', 'B'] }]])],
  ]);
  const ctx = { session, questions, connections: new Map([
    [host, { role: 'host' }],
    [student, { role: null }],
    [present, { role: 'present' }],
  ]) };
  try {
    dispatch(student, ctx, { type: 'student_join', name: 'Student' });
    const welcome = student.messages.find(m => m.type === 'welcome');
    dispatch(host, ctx, { type: 'start_question', questionFile: 'second.json', questionId: 'same', timeoutSec: 60 });
    assert.equal(student.messages.at(-1).code, 'second');
    assert.equal(session.activeQuestion.questionFile, 'second.json');

    const reconnected = socket();
    ctx.connections.set(reconnected, { role: null });
    dispatch(reconnected, ctx, { type: 'student_join', name: 'Student', reconnectToken: welcome.reconnectToken });
    assert.equal(reconnected.messages.at(-1).code, 'second');
    dispatch(reconnected, ctx, { type: 'submit_answer', questionId: 'same', answer: 'A,B' });
    assert.equal(reconnected.messages.at(-1).type, 'answer_received');

    dispatch(host, ctx, { type: 'end_question', questionId: 'same' });
    const result = reconnected.messages.find(m => m.type === 'round_result');
    assert.equal(result.correct, true);
    assert.equal(result.correctAnswer, 'A, B');
    dispatch(host, ctx, { type: 'preview_question', questionFile: 'first.json', questionId: 'same' });
    assert.equal(present.messages.at(-2).code, 'first');
    assert.equal(present.messages.at(-1).correctAnswer, 'first answer');

    dispatch(host, ctx, { type: 'start_question', questionFile: 'first.json', questionId: 'same', timeoutSec: 60 });
    assert.equal(reconnected.messages.at(-1).code, 'first');
    dispatch(host, ctx, { type: 'start_question', questionFile: 'missing.json', questionId: 'same', timeoutSec: 60 });
    assert.equal(host.messages.at(-1).type, 'question_error');
    assert.equal(host.messages.at(-1).action, 'start');
    assert.equal(session.activeQuestion.questionFile, 'first.json');
    dispatch(reconnected, ctx, { type: 'submit_answer', questionId: 'same', answer: ' FIRST   ANSWER ' });
    dispatch(host, ctx, { type: 'end_question', questionId: 'same' });
    assert.equal(reconnected.messages.at(-2).correct, true);
    assert.equal(reconnected.messages.at(-2).correctAnswer, 'first answer');

    dispatch(host, ctx, { type: 'start_question', questionFile: 'missing.json', questionId: 'same', timeoutSec: 60 });
    assert.equal(host.messages.at(-1).type, 'question_error');
    assert.equal(host.messages.at(-1).action, 'start');
    assert.equal(session.activeQuestion, null);
    dispatch(host, ctx, { type: 'preview_question', questionFile: 'second.json', questionId: 'missing' });
    assert.equal(host.messages.at(-1).action, 'preview');
  } finally {
    session.reset();
  }
});
