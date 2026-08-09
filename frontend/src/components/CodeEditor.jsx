import Editor from '@monaco-editor/react';
import '../services/monaco';
import { normalizeCodeLanguage } from '../utils/codeLanguages';
import { resolveMonacoTheme } from '../utils/editorTheme';

export default function CodeEditor({ value = '', language = 'plaintext', readOnly = false, theme = 'light', height = '320px', onChange, options = {}, ...props }) {
  return <Editor
    {...props}
    height={height}
    language={normalizeCodeLanguage(language)}
    value={value}
    theme={resolveMonacoTheme(theme)}
    onMount={(editor) => editor.layout()}
    onChange={(nextValue) => { if (!readOnly) onChange?.(nextValue ?? ''); }}
    options={{
      readOnly,
      domReadOnly: readOnly,
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
  />;
}
