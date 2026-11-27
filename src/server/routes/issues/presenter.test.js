import {
  presentIssue,
  presentEvidence,
  presentCphGroup,
  holdingPath
} from './presenter.js'

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

describe('#presentCphGroup', () => {
  test('Should present every issue and take the holding name from whichever has one', () => {
    const bare = { ...issue, id: 'other', context: { cph: '01/036/8000' } }
    const group = presentCphGroup({
      cph: '01/036/8000',
      issueCount: 2,
      latestUpdatedAtUtc: '2026-01-02T00:00:00Z',
      issues: [bare, issue]
    })

    expect(group.issueCount).toBe(2)
    expect(group.holdingName).toBe('Mount Farm')
    expect(group.holdingHref).toBe('/holdings/01/036/8000')
    expect(group.issues.map((i) => i.workflowDetail.name)).toHaveLength(2)
  })

  test('Should describe the holding status the backend worked out', () => {
    const group = presentCphGroup({
      cph: '01/036/8000',
      holdingStatus: 'closed',
      assignedTo: 'Alice Smith',
      issues: []
    })

    expect(group.holdingStatus).toMatchObject({ name: 'Closed' })
    expect(group.assignedTo).toBe('Alice Smith')
    expect(presentCphGroup({ cph: '', issues: [] }).holdingHref).toBeNull()
  })
})

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

  test('Should link to the holding page, at the issue, encoding each part of the CPH', () => {
    expect(presentIssue(issue).href).toBe(
      '/holdings/01/036/8000#issue-2-JBSWY3DPEHPK3PXP'
    )
    expect(holdingPath('C3161 #2')).toBe('/holdings/C3161%20%232')
    expect(presentIssue({ ...issue, context: {} }).href).toBeNull()
  })

  test('Should treat only an active To do or In progress issue as open', () => {
    expect(presentIssue(issue).isOpen).toBe(true)
    expect(presentIssue({ ...issue, status: 'inactive' }).isOpen).toBe(false)
    expect(
      presentIssue({ ...issue, workflowStatus: 'suppressed' }).isOpen
    ).toBe(false)
  })

  test("Should show an outcome's reason, and say when Can't resolve has none", () => {
    const reasoned = presentIssue({
      ...issue,
      workflowStatus: 'resolved',
      outcomeReason: 'Fixed in SAM'
    })
    const unreasoned = presentIssue({
      ...issue,
      workflowStatus: 'nonactionable'
    })
    const resolved = presentIssue({ ...issue, workflowStatus: 'resolved' })

    expect(reasoned.reason).toBe('Fixed in SAM')
    expect(unreasoned.reason).toBe('No reason given')
    expect(unreasoned.workflowDetail.name).toBe("Can't resolve")
    expect(resolved.reason).toBeNull()
    expect(presentIssue(issue).reason).toBeNull()
  })

  test("Should show an issue recorded as Ignored as Can't resolve", () => {
    expect(
      presentIssue({ ...issue, workflowStatus: 'ignored' }).workflowDetail.name
    ).toBe("Can't resolve")
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
