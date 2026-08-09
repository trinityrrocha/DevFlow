import { useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Loader2 } from 'lucide-react';
import '../services/monaco';
import { normalizeCodeLanguage } from '../utils/codeLanguages';
import { resolveMonacoTheme } from '../utils/editorTheme';

function EditorLoading({ minHeight }) {
  return <div style={{ minHeight }} className="flex w-full items-center justify-center bg-slate-950 text-sm text-slate-200"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando Editor...</div>;
}

export default function CodeEditor({ value = '', language = 'plaintext', readOnly = false, theme = 'light', height = '320px', minHeight, wrapperClassName = '', ariaLabel = 'Editor de codigo', onMount, options = {}, ...props }) {
  const editorRef = useRef(null);
  const resolvedMinHeight = minHeight || (readOnly ? height : '400px');
  const initialContent = readOnly ? { value } : { defaultValue: value };

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.layout();
    onMount?.(editor, monaco);
  };

  return <div
    className={`relative overflow-hidden rounded-lg border border-slate-300 bg-white p-1 shadow-sm focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 ${readOnly ? '' : 'cursor-text'} ${wrapperClassName}`}
    style={{ minHeight: resolvedMinHeight }}
    onClick={() => editorRef.current?.focus()}
  >
    <Editor
      {...props}
      {...initialContent}
      height={height}
      language={normalizeCodeLanguage(language)}
      theme={resolveMonacoTheme(theme)}
      loading={<EditorLoading minHeight={resolvedMinHeight} />}
      onMount={handleEditorDidMount}
      options={{
        readOnly,
        domReadOnly: readOnly,
        ariaLabel,
        placeholder: readOnly ? undefined : 'Cole ou digite o codigo aqui...',
        lineNumbers: 'on',
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        folding: true,
        glyphMargin: false,
        renderLineHighlight: readOnly ? 'none' : 'line',
        contextmenu: true,
        fontSize: 14,
        tabSize: 2,
        insertSpaces: true,
        padding: { top: 12, bottom: 12 },
        scrollbar: { alwaysConsumeMouseWheel: false },
        ...options
      }}
    />
  </div>;
}
