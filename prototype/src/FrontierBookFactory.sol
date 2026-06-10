// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RollingFrontierBook} from "./RollingFrontierBook.sol";

/// @notice Spins up independent rolling-frontier books. Markets are meant to
/// be cheap and ephemeral: anyone can launch one for any (token0, token1)
/// pair with whatever tick spacing fits their use case, run several in
/// parallel (e.g. a fine-grained book and a coarse one for the same pair),
/// and simply abandon a book once its orders are claimed/cancelled — books
/// hold no protocol-wide state and need no cleanup.
import {FrontierHookFlags} from "./hooks/IFrontierHooks.sol";

contract FrontierBookFactory {
    event BookCreated(
        address indexed book,
        address indexed token0,
        address indexed token1,
        int24 tickSpacing,
        int24 startTick,
        address creator,
        address hooks
    );

    address[] public books;
    /// shared delegatable-permission registry for all books (0 = owner-only)
    address public immutable permissionRegistry;
    /// canonical book per (token0, token1, spacing) for router path lookups
    mapping(address => mapping(address => mapping(int24 => address))) public getBook;
    /// first book created for a pair, any spacing — the v2-style default
    mapping(address => mapping(address => address)) public defaultBook;

    constructor(address _permissionRegistry) {
        permissionRegistry = _permissionRegistry;
    }

    function bookCount() external view returns (uint256) {
        return books.length;
    }

    function createBook(address token0, address token1, int24 tickSpacing, int24 startTick)
        external
        returns (address book)
    {
        return createBookWithHooks(token0, token1, tickSpacing, startTick, address(0));
    }

    /// @notice v4-style: the hooks contract's address encodes its permission
    /// flags in the low bits; books bind it immutably.
    function createBookWithHooks(address token0, address token1, int24 tickSpacing, int24 startTick, address hooks)
        public
        returns (address book)
    {
        require(token0 != token1 && token0 != address(0) && token1 != address(0), "bad tokens");
        book = address(new RollingFrontierBook(token0, token1, tickSpacing, startTick, hooks, permissionRegistry));
        books.push(book);
        if (getBook[token0][token1][tickSpacing] == address(0)) {
            getBook[token0][token1][tickSpacing] = book;
        }
        if (defaultBook[token0][token1] == address(0)) {
            defaultBook[token0][token1] = book;
        }
        emit BookCreated(book, token0, token1, tickSpacing, startTick, msg.sender, hooks);
    }
}
