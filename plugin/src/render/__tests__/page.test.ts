import {writeFileSync} from 'fs';
import {drawNotesPage, drawTasksPage, type PageTask} from '../page';
import {encodeGrayPng} from '../png';

const tasks: PageTask[] = [
  {name: 'Prepare the quarterly review deck', priority: 'P1', domain: 'Work', recurring: false, due: 'Due Thu 29 Oct'},
  {name: 'Reply to the supplier about the revised contract terms, plus the follow-up for the annual planning round', priority: 'P2', domain: 'Work', recurring: false, due: 'Due Sat 31 Oct'},
  {name: 'Clean the garden bins', priority: 'P3', domain: 'Home', recurring: true, due: 'Due Sun 1 Nov'},
  {name: 'Book a café for Zoë’s birthday (€ 45)', priority: 'P4', domain: null, recurring: false, due: 'No due date'},
];

const dark = (c: {pixels: Uint8Array; width: number}, top: number, bottom: number) => {
  let n = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = 0; x < c.width; x++) {
      if (c.pixels[y * c.width + x] < 128) n++;
    }
  }
  return n;
};

describe('drawTasksPage', () => {
  const c = drawTasksPage({title: 'Tasks', subtitle: 'Sun 1 Nov · 22:15', tasks, footer: 'Page 1 of 9 · 118 tasks'});

  it('draws ink in the filled rows and leaves the empty ones to the boxes', () => {
    expect(dark(c, 196, 308)).toBeGreaterThan(500);
    expect(dark(c, 196 + 112 * 12 + 20, 196 + 112 * 12 + 90)).toBeLessThan(dark(c, 196, 308));
  });

  it('writes a PNG for eyeballing when PAGE_OUT is set', () => {
    const png = encodeGrayPng(c.width, c.height, c.pixels);
    if (process.env.PAGE_OUT) {
      writeFileSync(`${process.env.PAGE_OUT}-tasks.png`, png);
    }
    expect(png.length).toBeLessThan(400_000);
  });
});

describe('drawNotesPage', () => {
  const c = drawNotesPage({title: 'Notes', subtitle: 'Sun 1 Nov'});

  it('shows the indent guides: a dark column at every guide', () => {
    for (let n = 1; n <= 6; n++) {
      const x = 96 + n * 80;
      expect(c.pixels[900 * c.width + x]).toBeLessThan(160);
    }
  });

  it('writes a PNG for eyeballing when PAGE_OUT is set', () => {
    const png = encodeGrayPng(c.width, c.height, c.pixels);
    if (process.env.PAGE_OUT) {
      writeFileSync(`${process.env.PAGE_OUT}-notes.png`, png);
    }
    expect(png.length).toBeLessThan(400_000);
  });
});
