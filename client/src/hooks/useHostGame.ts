import { useState, useEffect, useCallback, useRef } from 'react';
import type { Question, Score, ServerToHostMsg, StudentRoundResult } from '@ws-quiz/shared';
import { useSocket, wsUrl, apiUrl } from './useSocket.ts';
import type { ChatMsg } from '../components/Chat.tsx';
import { HOST } from '../labels.ts';

type Phase      = 'auth' | 'ready';
type FormSubmit = { preventDefault(): void };
type InputChange = { currentTarget: { value: string } };
type QuestionRef = { questionFile: string; questionId: string };

export function questionKey(questionFile: string, questionId: string): string {
  return JSON.stringify([questionFile, questionId]);
}

export interface Student {
  id: string;
  name: string;
}

export type HostChatMsg = ChatMsg & { readonly studentId: string };

export interface QuestionStat {
  status: 'idle' | 'active' | 'ended';
  answeredCount: number;
  totalStudents: number;
  correctCount: number;
}

let chatSeq = 0;

export interface HostGameApi {
  phase: Phase;
  tokenInput: string;
  authError: string;
  questionError: string;
  questionFiles: string[];
  questionFile: string;
  questions: Question[];
  timeoutSec: number;
  activeId: string;
  students: Student[];
  studentCount: number;
  questionStats: Record<string, QuestionStat>;
  scores: Score[];
  hostChats: HostChatMsg[];
  chatStudentId: string;
  unreadCount: number;
  status: 'connecting' | 'open' | 'closed';
  reconnected: boolean;
  handleAuth: (e: FormSubmit) => void;
  handleTokenChange: (e: InputChange) => void;
  handleTimeoutChange: (e: InputChange) => void;
  handleFileChange: (e: InputChange) => void;
  handleCardClick: (questionId: string) => void;
  handleReset: () => void;
  handleOverride: (studentId: string, correct: boolean) => () => void;
  handleChatStudentChange: (e: InputChange) => void;
  handleHostChatSend: (text: string) => void;
}

export function useHostGame(): HostGameApi {
  const { send, lastMessage, status, reconnected } = useSocket<ServerToHostMsg>(wsUrl());

  const [phase, setPhase]               = useState<Phase>('auth');
  const [tokenInput, setTokenInput]     = useState('');
  const [authError, setAuthError]       = useState('');
  const [questionError, setQuestionError] = useState('');
  const [questionFiles, setQuestionFiles] = useState<string[]>([]);
  const [questionFile, setQuestionFile] = useState('');
  const [questions, setQuestions]       = useState<Question[]>([]);
  const [timeoutSec, setTimeoutSec]     = useState(60);
  const [activeId, setActiveId]         = useState('');
  const [students, setStudents]         = useState<Student[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [questionStats, setQuestionStats] = useState<Record<string, QuestionStat>>({});
  const [scores, setScores]             = useState<Score[]>([]);
  const [hostChats, setHostChats]       = useState<HostChatMsg[]>([]);
  const [chatStudentId, setChatStudentId] = useState('');
  const [unreadCount, setUnreadCount]   = useState(0);

  const activeRef       = useRef<QuestionRef | null>(null);
  const endingRef       = useRef<QuestionRef | null>(null);
  const studentCountRef = useRef(0);
  const fileRequestRef  = useRef(0);

  const updateActive = useCallback((question: QuestionRef | null) => {
    setActiveId(question?.questionId ?? '');
    activeRef.current = question;
  }, []);

  const loadFile = useCallback((filename: string) => {
    const request = ++fileRequestRef.current;
    setQuestionFile(filename);
    setQuestions([]);
    setQuestionError('');
    fetch(apiUrl('/questions/' + encodeURIComponent(filename)))
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Question[]>;
      })
      .then(qs => { if (request === fileRequestRef.current) setQuestions(qs); })
      .catch((err: unknown) => {
        if (request === fileRequestRef.current) {
          setQuestionError(`Не удалось загрузить файл ${filename}: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
  }, []);

  useEffect(() => {
    if (!lastMessage) return;
    switch (lastMessage.type) {
      case 'auth_success':
        setPhase('ready');
        setAuthError('');
        fetch(apiUrl('/questions/index.json'))
          .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json() as Promise<string[]>;
          })
          .then(files => {
            setQuestionFiles(files);
            if (files.length > 0) loadFile(files[0]);
            else setQuestionError('На сервере нет файлов с вопросами');
          })
          .catch((err: unknown) => {
            setQuestionError(`Не удалось загрузить список файлов: ${err instanceof Error ? err.message : String(err)}`);
          });
        break;
      case 'auth_failed':
        setTokenInput('');
        setAuthError(lastMessage.reason);
        break;
      case 'student_joined': {
        const joined = { id: lastMessage.id, name: lastMessage.name };
        setStudents(prev => {
          if (prev.some(s => s.id === joined.id)) return prev;
          const next = [...prev, joined];
          setStudentCount(next.length);
          studentCountRef.current = next.length;
          return next;
        });
        break;
      }
      case 'student_answered': {
        const active = activeRef.current;
        if (active) {
          const key = questionKey(active.questionFile, active.questionId);
          setQuestionStats(prev => {
            const cur = prev[key] ?? { status: 'active' as const, answeredCount: 0, totalStudents: 0, correctCount: 0 };
            return { ...prev, [key]: { ...cur, answeredCount: cur.answeredCount + 1 } };
          });
        }
        break;
      }
      case 'round_results': {
        const ended = endingRef.current ?? activeRef.current;
        endingRef.current = null;
        if (activeRef.current === ended) updateActive(null);
        if (ended) {
          const key = questionKey(ended.questionFile, ended.questionId);
          const results = lastMessage.results;
          const correct = results.filter((r: StudentRoundResult) => r.correct).length;
          setQuestionStats(prev => ({
            ...prev,
            [key]: {
              status: 'ended',
              answeredCount: results.length,
              totalStudents: studentCountRef.current,
              correctCount: correct,
            },
          }));
        }
        break;
      }
      case 'question_error': {
        setQuestionError(`${lastMessage.reason}: ${lastMessage.questionFile} / ${lastMessage.questionId}`);
        if (lastMessage.action === 'start') {
          const key = questionKey(lastMessage.questionFile, lastMessage.questionId);
          setQuestionStats(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          const active = activeRef.current;
          if (active && questionKey(active.questionFile, active.questionId) === key) updateActive(null);
        }
        break;
      }
      case 'scoreboard_update':
        setScores(lastMessage.scores);
        break;
      case 'chat_from_student': {
        const msg: HostChatMsg = {
          id: String(++chatSeq),
          from: lastMessage.name,
          text: lastMessage.text,
          own: false,
          studentId: lastMessage.studentId,
        };
        setHostChats(prev => [...prev, msg]);
        setUnreadCount(n => n + 1);
        break;
      }
    }
  }, [lastMessage, loadFile, updateActive]);

  const handleAuth = useCallback((e: FormSubmit) => {
    e.preventDefault();
    send({ type: 'host_auth', token: tokenInput });
  }, [tokenInput, send]);

  const handleTokenChange   = useCallback((e: InputChange) => { setTokenInput(e.currentTarget.value); }, []);
  const handleTimeoutChange = useCallback((e: InputChange) => { setTimeoutSec(Number(e.currentTarget.value)); }, []);
  const handleFileChange    = useCallback((e: InputChange) => { loadFile(e.currentTarget.value); }, [loadFile]);

  const handleCardClick = useCallback((questionId: string) => {
    const key = questionKey(questionFile, questionId);
    const stat = questionStats[key];
    setQuestionError('');

    if (stat?.status === 'ended') {
      send({ type: 'preview_question', questionFile, questionId });
      return;
    }

    if (stat?.status === 'active') {
      endingRef.current = activeRef.current;
      updateActive(null);
      send({ type: 'end_question', questionId });
      return;
    }

    // idle → start (possibly ending current active first)
    const currentActive = activeRef.current;
    if (currentActive) {
      endingRef.current = currentActive;
      send({ type: 'end_question', questionId: currentActive.questionId });
    }

    updateActive({ questionFile, questionId });
    setQuestionStats(prev => ({
      ...prev,
      [key]: {
        status: 'active',
        answeredCount: 0,
        totalStudents: studentCountRef.current,
        correctCount: 0,
      },
    }));
    send({ type: 'start_question', questionFile, questionId, timeoutSec });
  }, [questionFile, questionStats, timeoutSec, send, updateActive]);

  const handleReset = useCallback(() => {
    send({ type: 'reset_session' });
    setStudents([]);
    setStudentCount(0);
    studentCountRef.current = 0;
    setScores([]);
    setQuestionStats({});
    endingRef.current = null;
    updateActive(null);
  }, [send, updateActive]);

  const handleOverride = useCallback((studentId: string, correct: boolean) => () => {
    send({ type: 'override_score', studentId, correct });
  }, [send]);

  const handleChatStudentChange = useCallback((e: InputChange) => {
    setChatStudentId(e.currentTarget.value);
    setUnreadCount(0);
  }, []);

  const handleHostChatSend = useCallback((text: string) => {
    if (!chatStudentId) return;
    send({ type: 'chat_to_student', studentId: chatStudentId, text });
    setHostChats(prev => [...prev, {
      id: String(++chatSeq),
      from: HOST.chatOwn,
      text,
      own: true,
      studentId: chatStudentId,
    }]);
  }, [send, chatStudentId]);

  return {
    phase, tokenInput, authError, questionError, questionFiles, questionFile,
    questions, timeoutSec, activeId,
    students, studentCount, questionStats, scores,
    hostChats, chatStudentId, unreadCount, status, reconnected,
    handleAuth, handleTokenChange, handleTimeoutChange, handleFileChange,
    handleCardClick, handleReset, handleOverride, handleChatStudentChange, handleHostChatSend,
  };
}
