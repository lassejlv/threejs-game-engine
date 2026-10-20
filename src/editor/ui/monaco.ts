import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { SCRIPT_TYPES } from '../scriptTypes'

/**
 * Monaco, configured for project scripts. Imported lazily (it is large), so
 * the editor only downloads it the first time a script is opened.
 */
self.MonacoEnvironment = {
  getWorker: (_id, label) => (label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker()),
}

const js = monaco.typescript.javascriptDefaults
js.setCompilerOptions({
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.ESNext,
  allowNonTsExtensions: true,
  allowJs: true,
  checkJs: true,
  noEmit: true,
})
js.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false })
js.addExtraLib(SCRIPT_TYPES, 'file:///engine-scripts.d.ts')

monaco.editor.defineTheme('engine-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#13161b', 'editorGutter.background': '#13161b' },
})

export { monaco }
