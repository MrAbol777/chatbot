import { useMemo } from 'react';
import { Button } from '../../design-system/components';
import type { PromptVersion } from '../admin.types';

type DiffLine = {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

function computeSimpleLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const diffs: DiffLine[] = [];

  // Simple and fast LCS / greedy diff algorithm for text prompts
  let i = 0;
  let j = 0;
  let oldNum = 1;
  let newNum = 1;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diffs.push({
        type: 'unchanged',
        content: oldLines[i],
        oldLineNumber: oldNum++,
        newLineNumber: newNum++
      });
      i++;
      j++;
    } else if (j < newLines.length && (i >= oldLines.length || !oldLines.slice(i).includes(newLines[j]))) {
      diffs.push({
        type: 'added',
        content: newLines[j],
        newLineNumber: newNum++
      });
      j++;
    } else if (i < oldLines.length) {
      diffs.push({
        type: 'removed',
        content: oldLines[i],
        oldLineNumber: oldNum++
      });
      i++;
    }
  }

  return diffs;
}

type PromptDiffViewerProps = {
  version: PromptVersion;
  currentPrompt: string;
  onClose: () => void;
  onRollback?: (version: PromptVersion) => void;
  canRollback?: boolean;
};

export default function PromptDiffViewer({
  version,
  currentPrompt,
  onClose,
  onRollback,
  canRollback
}: PromptDiffViewerProps) {
  const oldPrompt = version.prompt || '';
  const diffLines = useMemo(() => computeSimpleLineDiff(oldPrompt, currentPrompt), [oldPrompt, currentPrompt]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const line of diffLines) {
      if (line.type === 'added') additions++;
      if (line.type === 'removed') deletions++;
    }
    return { additions, deletions };
  }, [diffLines]);

  return (
    <div className="prompt-diff-modal" role="dialog" aria-modal="true" aria-labelledby="diff-viewer-title">
      <div className="prompt-diff-card">
        <div className="prompt-diff-header">
          <div>
            <h3 id="diff-viewer-title">
              مقایسه تفاوت‌ها (Diff): نسخه {version.version} با پرامپت جاری
            </h3>
            <div className="prompt-diff-meta">
              <span>ثبت‌کننده: <strong>{version.author}</strong></span>
              <span>تاریخ ثبت: {new Date(version.createdAt).toLocaleString('fa-IR')}</span>
              {version.note ? <span>توضیح: {version.note}</span> : null}
            </div>
          </div>
          <div className="prompt-diff-stats">
            <span className="diff-tag diff-tag--add">+{stats.additions} خط اضافه</span>
            <span className="diff-tag diff-tag--del">-{stats.deletions} خط حذف</span>
            <Button variant="ghost" size="sm" onClick={onClose}>بستن</Button>
          </div>
        </div>

        <div className="prompt-diff-body" dir="ltr">
          <table className="prompt-diff-table">
            <tbody>
              {diffLines.map((line, index) => (
                <tr key={index} className={`diff-row diff-row--${line.type}`}>
                  <td className="diff-line-no diff-line-no--old">{line.oldLineNumber || ''}</td>
                  <td className="diff-line-no diff-line-no--new">{line.newLineNumber || ''}</td>
                  <td className="diff-line-marker">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </td>
                  <td className="diff-line-content">
                    <code>{line.content || ' '}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="prompt-diff-footer">
          <div className="admin-note" style={{ margin: 0 }}>
            سبز (+) خطوط پرامپت فعلی است که در نسخه {version.version} وجود ندارد. قرمز (-) خطوط نسخه {version.version} است که در پرامپت فعلی حذف شده است.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="secondary" onClick={onClose}>انصراف</Button>
            {canRollback && onRollback ? (
              <Button
                variant="danger"
                onClick={() => {
                  onClose();
                  onRollback(version);
                }}
              >
                بازگردانی به نسخه {version.version}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
