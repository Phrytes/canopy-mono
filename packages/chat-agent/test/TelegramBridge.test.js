import { describe, it, expect } from 'vitest';
import { layoutButtons } from '../src/bridges/TelegramBridge.js';

describe('layoutButtons', () => {
  it('default: each button on its own row (so long lists stay readable)', () => {
    const out = layoutButtons([
      { label: '✓ kaas',   id: 'ik heb kaas van boodschappen'   },
      { label: '✓ eieren', id: 'ik heb eieren van boodschappen' },
      { label: '✓ melk',   id: 'ik heb melk van boodschappen'   },
    ]);
    expect(out).toEqual([
      [{ text: '✓ kaas',   callback_data: 'ik heb kaas van boodschappen'   }],
      [{ text: '✓ eieren', callback_data: 'ik heb eieren van boodschappen' }],
      [{ text: '✓ melk',   callback_data: 'ik heb melk van boodschappen'   }],
    ]);
  });

  it('honours an explicit 2D shape from the caller', () => {
    const out = layoutButtons([
      [{ label: 'Yes', id: 'yes' }, { label: 'No', id: 'no' }],
      [{ label: 'Cancel', id: 'cancel' }],
    ]);
    expect(out).toEqual([
      [{ text: 'Yes',    callback_data: 'yes'    }, { text: 'No', callback_data: 'no' }],
      [{ text: 'Cancel', callback_data: 'cancel' }],
    ]);
  });

  it('groups by `row` field when present', () => {
    const out = layoutButtons([
      { label: 'A', id: 'a', row: 0 },
      { label: 'B', id: 'b', row: 0 },
      { label: 'C', id: 'c', row: 1 },
    ]);
    expect(out).toEqual([
      [{ text: 'A', callback_data: 'a' }, { text: 'B', callback_data: 'b' }],
      [{ text: 'C', callback_data: 'c' }],
    ]);
  });
});
