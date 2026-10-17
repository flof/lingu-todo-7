import type { ReactElement } from 'react';

export const EMOJI_CHOICES = ['🛒', '🧳', '🏠', '🧹', '🎁', '🍽️', '📦', '🎉', '🛠️', '🧺'];

export function EmojiPicker({
  value,
  onChange,
  label = 'Icon',
}: {
  value: string;
  onChange: (emoji: string) => void;
  label?: string;
}): ReactElement {
  return (
    <div className="emoji-picker" role="group" aria-label={label}>
      {EMOJI_CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          className={choice === value ? 'emoji chosen' : 'emoji'}
          aria-pressed={choice === value}
          onClick={() => onChange(choice)}
        >
          {choice}
        </button>
      ))}
    </div>
  );
}
