#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, transfer};
use crate::constants::*;
use crate::state::*;
use crate::instructions::utils::*;
use crate::instructions::register::utils::*;
use crate::error::CaRegistrarError;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

/// Event emitted when a domain is renewed
#[event]
pub struct RenewDomainEvent {
    pub domain_name: String,
    pub payer: Pubkey,
    pub owner: Pubkey,
    pub years: u64,
    pub fee: u64,
    pub old_expiry: i64,
    pub new_expiry: i64,
}

/// Account constraints for domain renewal instruction
/// 
/// This instruction allows anyone to renew any domain that is not expired or is within the grace period.
/// Renewal only extends the domain's expiration date and does not change ownership.
#[derive(Accounts)]
#[instruction(domain_name: String)]
pub struct RenewDomainAccountConstraints<'info> {
    /// User paying for domain renewal fees
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Domain record account to be renewed
    #[account(
        mut,
        seeds = [DOMAIN_RECORD_SEED, domain_name.as_bytes()],
        bump = domain_record.bump,
    )]
    pub domain_record: Account<'info, DomainRecord>,

    /// Program state account
    #[account(
        mut,
        seeds = [PROGRAM_STATE_SEED],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,

    /// Pyth price oracle account (SOL/USD price)
    /// Used to calculate accurate SOL amounts
    pub pyth_price_update: Account<'info, PriceUpdateV2>,

    pub system_program: Program<'info, System>,
}

/// Domain renewal instruction handler
/// 
/// # Parameters
/// * `context` - Instruction context, containing all relevant accounts
/// * `years` - Renewal period in years, minimum 1 year
/// 
/// # Errors
/// * `InvalidRegisterYears` - Registration period is invalid
pub fn renew_domain_handler(
    context: Context<RenewDomainAccountConstraints>,
    years: u64,
) -> Result<()> {
    // Validate years
    require!(years > 0 && years <= 99, CaRegistrarError::InvalidRegisterYears);

    // Get current timestamp
    let current_timestamp = get_current_timestamp()?;
    
    // Get domain record and program state
    let domain_record = &mut context.accounts.domain_record;
    let program_state = &context.accounts.program_state;
    
    // Check if domain is expired and beyond grace period
    let is_expired = domain_record.is_expired(current_timestamp);
    let is_in_grace_period = domain_record.is_in_grace_period(
        current_timestamp, 
        program_state.grace_period_seconds
    );
    
    // If domain is expired and beyond grace period, renewal is not allowed, buy_domain instruction must be used
    require!(
        !is_expired || is_in_grace_period,
        CaRegistrarError::DomainExpiredBeyondGracePeriod
    );
    
    // Calculate fee using Pyth oracle
    let yearly_fee = calculate_yearly_fee_in_lamports(
        &context.accounts.pyth_price_update,
        context.accounts.program_state.base_price_usd,  // Pass price value directly
        years,
    )?;
    
    // Transfer fee to program state account
    transfer(
        CpiContext::new(
            context.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: context.accounts.payer.to_account_info(),
                to: context.accounts.program_state.to_account_info(),
            },
        ),
        yearly_fee,
    )?;

    // for event
    let old_expiry_timestamp = domain_record.expiry_timestamp;
    let domain_name = domain_record.domain_name.clone();
    let owner = domain_record.owner;

    // Update domain expiry time
    // If current time is past the original expiry time, calculate from current time
    // Otherwise, add years to the original expiry time
    let new_expiry_timestamp = if current_timestamp > domain_record.expiry_timestamp {
        calculate_expiry_timestamp(current_timestamp, years)
    } else {
        calculate_expiry_timestamp(domain_record.expiry_timestamp, years)
    };
    
    domain_record.expiry_timestamp = new_expiry_timestamp;
    
    msg!("Domain {} renewed successfully for {} years", domain_record.domain_name, years);
    
    emit!(RenewDomainEvent {
        domain_name,
        payer: context.accounts.payer.key(),
        owner,
        years,
        fee: yearly_fee,
        old_expiry: old_expiry_timestamp,
        new_expiry: new_expiry_timestamp,
    });
    
    Ok(())
} 