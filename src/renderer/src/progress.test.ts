import { describe, expect, it } from 'vitest'
import { busyText } from './progress'

describe('busyText', () => {
  it('says what runs, and how far it is when git reports it', () => {
    expect(busyText('Fetching')).toBe('Fetching…')
    expect(busyText('Pushing', { phase: 'Counting objects', percent: 5 })).toBe(
      'Pushing… Counting objects 5%'
    )
    expect(
      busyText('Pushing', { phase: 'Writing objects', percent: 52, transfer: '1.20 MiB, 1 MiB/s' })
    ).toBe('Pushing… Writing objects 52% · 1.20 MiB, 1 MiB/s')
    expect(busyText('Pushing', { phase: 'Something new', percent: null })).toBe(
      'Pushing… Something new'
    )
  })

  it('waits for the remote once a push has sent everything', () => {
    expect(busyText('Pushing', { phase: 'Writing objects', percent: 90 })).toBe(
      'Pushing… waiting for the remote'
    )
  })
})
