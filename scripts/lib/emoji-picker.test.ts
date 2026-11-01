import { describe, expect, it } from 'vitest'
import { parseEmojiPicker } from './emoji-picker'

const html = `
<yt-emoji-picker-category-renderer>
  <img height="24" width="24"
    src="https://yt3.ggpht.com/aaa=w48-h48-c-k-nd"
    aria-label=":_YUNOlove:" alt="YUNOlove"
    id="UC99kOG6_9RD0mR3OG4EOfxw/54y5aNPZFd-QoPwPxrGNqQk">
  <img height="24" width="24"
    src="https://yt3.ggpht.com/bbb=w48-h48-c-k-nd"
    aria-label=":_YUNOwww:" alt="YUNOwww"
    id="UC99kOG6_9RD0mR3OG4EOfxw/54y5aOLXFd-QoPwPxrGNqQk">
  <img src="https://example.com/not-a-channel-emoji.png" id="emoji/unicode">
  <img src="https://yt3.ggpht.com/dup=w48-h48-c-k-nd" id="UC99kOG6_9RD0mR3OG4EOfxw/54y5aNPZFd-QoPwPxrGNqQk">
</yt-emoji-picker-category-renderer>`

describe('parseEmojiPicker', () => {
  it('extracts id, name and image url, deduping by id', () => {
    expect(parseEmojiPicker(html)).toEqual([
      {
        id: 'UC99kOG6_9RD0mR3OG4EOfxw/54y5aNPZFd-QoPwPxrGNqQk',
        name: 'YUNOlove',
        url: 'https://yt3.ggpht.com/aaa=w48-h48-c-k-nd',
      },
      {
        id: 'UC99kOG6_9RD0mR3OG4EOfxw/54y5aOLXFd-QoPwPxrGNqQk',
        name: 'YUNOwww',
        url: 'https://yt3.ggpht.com/bbb=w48-h48-c-k-nd',
      },
    ])
  })

  it('returns nothing for non-picker HTML', () => {
    expect(parseEmojiPicker('<html><body>hello</body></html>')).toEqual([])
  })
})
