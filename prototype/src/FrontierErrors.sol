// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// FrontierErrors — shared custom errors for the core book pair
//
// The deployable book (UniformFrontierBook / GeometricFrontierBook) and its
// delegatecalled maker-ops companion (UniformMakerOps / GeometricMakerOps)
// share one storage layout AND one revert vocabulary, so their custom-error
// selectors must come from a single definition — otherwise the same logical
// failure would carry a different selector depending on which half of the pair
// executed it. Defining them here (free-floating, file-level) gives both
// contracts, the periphery, and the test-suite the identical Error.selector to
// assert against.
//
// Custom errors replace the old string requires: the revert path no longer
// stores/loads a UTF-8 message (4-byte selector vs. a 32-byte-aligned ABI
// string), which trims both deployed bytecode and the gas burned when a call
// reverts (router probes, keeper *Auto min-out guards, fuzz reverts).

// ----- position state / authorization -----
error NotLive();
error NotOwner();
error NotABid();
error UseBidMethods();
error NotALiveAsk();
error NotALiveBid();
error ZeroOwner();

// ----- amounts / ranges -----
error ZeroLiquidity();
error EmptyRange();
error Unaligned();
error RangeNotAbovePrice();
error RangeNotBelowPrice();
error BadTarget();
error UnalignedTarget();
error NotFilled();
error NothingToClaim();
error BelowMinProceeds();
error PartiallyFilled();
error FrontierOutOfRange();
error UnalignedFrontier();
error FrontierNotFilled();
error FrontierNotMaximal();

// ----- shadow LP -----
error ZeroAmounts();
error ImbalancedFirstDeposit();
error EmptyPool();
error InsufficientShares();
error ZeroShares();
error InsufficientAmounts();

// ----- config -----
error BadSpacing();
error FeeTooHigh();
error FeeRecipientRequired();

// ----- runtime invariants / fills -----
error NegativeRun();
error NegativeActive();
error RateUnderflow();
error Expired();
error InsufficientOutput();
error HookRejected();

// ----- token transfers -----
error TransferInFailed();
error TransferOutFailed();
error FeeTransferFailed();
error ShadowFeeTransferFailed();
error FillPayoutFailed();
error NonExactTransfer();
