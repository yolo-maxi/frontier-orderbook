// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Vault {
    function balanceOf(address owner) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IFrontierVault {
    function debit(address user, address token, uint256 amount) external;
    function credit(address user, address token, uint256 amount) external;
    function pay(address token, address to, uint256 amount) external;
    function withdraw(address token, uint256 amount) external;
}

/// @notice Prototype singleton credit vault for Frontier books.
///
/// Users hold liquid ERC20 credits here. Authorized books can debit those
/// credits when a maker deploys liquidity, can credit settled proceeds/refunds,
/// and can pay takers out of vault custody during fills.
contract FrontierVault is IFrontierVault {
    address public owner;

    mapping(address => bool) public authorizedBook;
    mapping(address => mapping(address => uint256)) public balanceOf;
    mapping(address => uint256) public totalCredits;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event BookAuthorization(address indexed book, bool authorized);
    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed user, address indexed token, uint256 amount);
    event BookDebit(address indexed book, address indexed user, address indexed token, uint256 amount);
    event BookCredit(address indexed book, address indexed user, address indexed token, uint256 amount);
    event BookPay(address indexed book, address indexed token, address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyBook() {
        require(authorizedBook[msg.sender], "not book");
        _;
    }

    constructor(address _owner) {
        require(_owner != address(0), "zero owner");
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setBookAuthorization(address book, bool authorized) external onlyOwner {
        require(book != address(0), "zero book");
        authorizedBook[book] = authorized;
        emit BookAuthorization(book, authorized);
    }

    function deposit(address token, uint256 amount) external {
        require(amount > 0, "zero amount");
        balanceOf[msg.sender][token] += amount;
        totalCredits[token] += amount;
        require(IERC20Vault(token).transferFrom(msg.sender, address(this), amount), "transfer in failed");
        emit Deposit(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external {
        balanceOf[msg.sender][token] -= amount;
        totalCredits[token] -= amount;
        require(IERC20Vault(token).transfer(msg.sender, amount), "transfer out failed");
        emit Withdraw(msg.sender, token, amount);
    }

    /// @notice Consume liquid credit for new deployed liquidity. No ERC20
    /// moves; custody remains in this singleton.
    function debit(address user, address token, uint256 amount) external onlyBook {
        if (amount == 0) return;
        balanceOf[user][token] -= amount;
        totalCredits[token] -= amount;
        emit BookDebit(msg.sender, user, token, amount);
    }

    /// @notice Materialize settled proceeds/refunds as liquid credit.
    function credit(address user, address token, uint256 amount) external onlyBook {
        if (amount == 0) return;
        balanceOf[user][token] += amount;
        totalCredits[token] += amount;
        require(solvent(token), "insolvent credit");
        emit BookCredit(msg.sender, user, token, amount);
    }

    /// @notice Pay a taker from vault custody. The vault prevents authorized
    /// books from draining already-liquid user credits, but active-liquidity
    /// solvency still depends on correct book accounting.
    function pay(address token, address to, uint256 amount) external onlyBook {
        if (amount == 0) return;
        require(IERC20Vault(token).transfer(to, amount), "transfer out failed");
        require(solvent(token), "insolvent pay");
        emit BookPay(msg.sender, token, to, amount);
    }

    function solvent(address token) public view returns (bool) {
        return IERC20Vault(token).balanceOf(address(this)) >= totalCredits[token];
    }
}
