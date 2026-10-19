#!/usr/bin/env node

// Static contract test: all addons must prefer MNUtils' canonical Extend Note
// predicate while retaining a bridge-field fallback for older MNUtils builds.
const assert = require('node:assert/strict')
const fs = require('./support/integration-fs.js')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..', '..')
const contracts = [
  {
    file: path.join(repoRoot, 'mnknowledgebase', 'main.js'),
    functionMarker: 'const isKnowledgeBaseExtendNote = function(noteOrId)',
    canonical: 'MNUtil.isExtendNote(noteOrId)',
    fallback: 'hasKnowledgeBaseExtendBlankHighlight(nativeNote)'
  },
  {
    file: path.join(repoRoot, 'mnpinner', 'src', 'main.js'),
    functionMarker: 'const pinnerIsExtendNote = (target)',
    canonical: 'MNUtil.isExtendNote(target)',
    fallback: 'pinnerHasBlankHighlight(note)'
  },
  {
    file: path.join(repoRoot, 'mnliterature', 'main.js'),
    functionMarker: 'const literatureIsExtendNote = function(target)',
    canonical: 'MNUtil.isExtendNote(target)',
    fallback: 'literatureHasBlankHighlight(note)'
  },
  {
    file: path.join(repoRoot, 'mncommentmanager', 'src', 'MNCommentManagerAddon.js'),
    functionMarker: 'function isExtendNote(target)',
    canonical: 'MNUtil.isExtendNote(target)',
    fallback: 'hasBlankHighlight(note)'
  }
]

for (const contract of contracts) {
  const source = fs.readFileSync(contract.file, 'utf8')
  const functionStart = source.indexOf(contract.functionMarker)
  assert.notEqual(functionStart, -1, `${contract.file}: Extend Note function is missing`)

  // The functions are small and intentionally contain the canonical call and
  // fallback in one block. Restrict the check to avoid matching unrelated
  // helpers elsewhere in a large addon entry file.
  const functionBody = source.slice(functionStart, functionStart + 1800)
  const canonicalIndex = functionBody.indexOf(contract.canonical)
  const fallbackIndex = functionBody.indexOf(contract.fallback)
  assert.notEqual(canonicalIndex, -1, `${contract.file}: canonical MNUtil.isExtendNote call is missing`)
  assert.notEqual(fallbackIndex, -1, `${contract.file}: legacy Extend Note fallback is missing`)
  assert.ok(canonicalIndex < fallbackIndex, `${contract.file}: canonical check must run before fallback`)
}

console.log('Extend Note canonical-first contract regression ok')
