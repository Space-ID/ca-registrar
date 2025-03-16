//! Error definitions for the CA-Registrar program.
//!
//! This module defines all error types that can be returned by the program's
//! instruction handlers. Each error includes a corresponding error message
//! that will be returned to clients when the error occurs.

use anchor_lang::prelude::*;

#[error_code]
pub enum CaRegistrarError {
    #[msg("Invalid domain name length")]
    InvalidDomainLength,
    
    #[msg("Invalid number of years for registration")]
    InvalidRegisterYears,
    
    #[msg("Only the domain owner can perform this action")]
    NotDomainOwner,
    
    #[msg("Domain is expired")]
    DomainExpired,
    
    #[msg("Insufficient payment")]
    InsufficientPayment,
    
    #[msg("Only the program authority can perform this action")]
    NotProgramAuthority,

    #[msg("Invalid price feed account")]
    InvalidPriceFeed,
    
    #[msg("Calculation overflow")]
    MathOverflow,
    
    #[msg("Domain is expired beyond grace period, use buy_domain instead")]
    DomainExpiredBeyondGracePeriod,
    
    #[msg("Domain is not available for purchase, must be expired and beyond grace period")]
    DomainNotAvailableForPurchase,
    
    #[msg("Too many addresses. Maximum allowed is 20")]
    TooManyAddresses,
}
