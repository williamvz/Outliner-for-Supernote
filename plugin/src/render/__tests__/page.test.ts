import {writeFileSync} from 'fs';
import {drawTodayPage, type PageContent} from '../page';
import {encodeGrayPng} from '../png';

const content: PageContent = {
  title: 'Sun 1 Nov',
  subtitle: '33 open · +27 more',
  tasks: [
    {name: 'Prepare the quarterly review deck', priority: 'P1', domain: 'Work', recurring: false, due: '3 days late'},
    {name: 'Reply to the supplier about the revised contract terms, plus the follow-up for the annual planning round', priority: 'P2', domain: 'Work', recurring: false, due: 'today'},
    {name: 'Clean the garden bins', priority: 'P3', domain: 'Home', recurring: true, due: 'today'},
    {name: 'Book a café for Zoë’s birthday (€ 45)', priority: 'P4', domain: 'Home', recurring: false, due: null},
  ],
};

describe('drawTodayPage', () => {
  it('draws ink in the task rows and leaves the writing area free of text', () => {
    const c = drawTodayPage(content);
    const dark = (top: number, bottom: number) => {
      let n = 0;
      for (let y = top; y < bottom; y++) {
        for (let x = 0; x < c.width; x++) {
          if (c.pixels[y * c.width + x] < 128) n++;
        }
      }
      return n;
    };
    expect(dark(196, 304)).toBeGreaterThan(500); // first task row
    expect(dark(1000, 1100)).toBe(0); // writing area: only faint rules
  });

  it('writes a PNG for eyeballing when PAGE_OUT is set', () => {
    const c = drawTodayPage(content);
    const png = encodeGrayPng(c.width, c.height, c.pixels);
    if (process.env.PAGE_OUT) {
      writeFileSync(process.env.PAGE_OUT, png);
    }
    expect(png.length).toBeGreaterThan(1000);
    expect(png.length).toBeLessThan(400_000);
  });
});
