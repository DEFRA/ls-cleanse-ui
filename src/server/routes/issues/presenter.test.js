import { presentIssue, presentEvidence } from './presenter.js'

const issue = {
  id: '2-JBSWY3DPEHPK3PXP',
  ruleId: '2',
  status: 'active',
  workflowStatus: 'todo',
  version: 3,
  context: {
    cph: '01/036/8000',
    ruleNumber: '2',
    errorCode: '02',
    errorDescription: 'CTS-CPH-missing-in-Sam',
    ctsLocationNumber: 'AH-01/036/8000',
    ctsKeeperSurname: 'SANDERSON',
    samFeatureName: 'Mount Farm',
    samSpeciesCodes: 'HRS,SHP'
  }
}

describe('#presentIssue', () => {
  test('Should read everything on screen from the context, never the opaque id', () => {
    const presented = presentIssue(issue)

    expect(presented.cph).toBe('01/036/8000')
    expect(presented.ruleNumber).toBe('2')
    expect(presented.errorDescription).toBe('CTS-CPH-missing-in-Sam')
    expect(presented.holdingName).toBe('Mount Farm')
  })

  test('Should fall back to the rule when no description was written', () => {
    const bare = presentIssue({ ...issue, context: { ruleNumber: '7' } })

    expect(bare.errorDescription).toBe('Rule 7')
  })

  test('Should survive an issue with no context at all', () => {
    expect(() => presentIssue({ ...issue, context: undefined })).not.toThrow()
  })

  test('Should offer only the moves the backend allows, and never a no-op', () => {
    const todo = presentIssue(issue).can
    expect(todo).toMatchObject({
      resolve: true,
      suppress: true,
      ignore: true,
      reopen: false
    })

    const suppressed = presentIssue({
      ...issue,
      workflowStatus: 'suppressed'
    }).can
    // Suppressed cannot be suppressed again, but can be lifted back to To do.
    expect(suppressed).toMatchObject({ suppress: false, reopen: true })

    const ignored = presentIssue({ ...issue, workflowStatus: 'ignored' }).can
    expect(ignored).toMatchObject({
      resolve: false,
      suppress: false,
      reopen: true
    })
  })
})

describe('#presentEvidence', () => {
  test('Should split the context into the two systems being compared', () => {
    const { cts, sam } = presentEvidence(issue)

    expect(cts.map((row) => row.key.text)).toEqual([
      'Location number',
      'Keeper surname'
    ])
    expect(sam.map((row) => row.key.text)).toEqual([
      'Holding name',
      'Species recorded'
    ])
  })

  test('Should leave the SAM side empty when SAM holds nothing, which is rule 2 itself', () => {
    const { cts, sam } = presentEvidence({
      context: { cph: '01/036/8000', ctsKeeperSurname: 'SANDERSON' }
    })

    expect(cts).toHaveLength(1)
    expect(sam).toEqual([])
  })

  test('Should keep the identity keys out of the evidence, since they are shown elsewhere', () => {
    const shown = presentEvidence(issue)
    const keys = [...shown.cts, ...shown.sam, ...shown.other].map(
      (row) => row.key.text
    )

    expect(keys).not.toContain('Cph')
    expect(keys).not.toContain('Error code')
  })

  test('Should humanise a context key the rules engine adds later', () => {
    const { other } = presentEvidence({ context: { someNewSignal: 'yes' } })

    expect(other).toEqual([
      { key: { text: 'Some new signal' }, value: { text: 'yes' } }
    ])
  })
})
