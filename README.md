# Uniswap-Style One-Way Range Take-Profit Orders

Status: requirements/spec draft
Date: 2026-06-10
Owner: Fran

## Purpose

Define the desired behavior for a Uniswap-compatible mechanism that lets users place one-way range take-profit orders.

The implementation form is intentionally left open:

- best case: Uniswap v4 hook
- acceptable: Uniswap-compatible vault/periphery
- acceptable: custom AMM/order pool with Uniswap-like position semantics
- fallback: external accounting system routing through Uniswap liquidity

This folder is a requirements package, not an implementation plan.

## Core idea

Users place sell orders across tick ranges. When price traverses part of a range in the sell direction, that portion of the order is consumed exactly once. The resulting proceeds become claimable by the user, similar to how Uniswap LP fees are lazily collected.

Unlike normal Uniswap LP liquidity, consumed sell liquidity must not become active again if price reverses.

## Files

- `requirements.md` — product/mechanism requirements
- `invariants.md` — correctness properties that must always hold
- `test-plan.md` — Solidity/Foundry test scenarios and gas properties
- `accounting-scenarios.md` — concrete Bob/Alice/Carol examples
- `open-questions.md` — unresolved design questions and feasibility risks
