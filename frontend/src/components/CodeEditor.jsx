import Editor from '@monaco-editor/react';
import '../services/monaco';

export default function CodeEditor(props) {
  return <Editor {...props} />;
}
