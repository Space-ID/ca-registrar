#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use crate::constants::*;
use crate::state::*;
use crate::error::CaRegistrarError;

/// Account constraints for withdrawing fees instruction
/// 
/// This instruction allows anyone to withdraw SOL from the program state account.
/// The withdrawn funds will be sent to the authority account.
#[derive(Accounts)]
pub struct WithdrawFeesAccountConstraints<'info> {
    /// caller - can be anyone
    #[account(mut)]
    pub signer: Signer<'info>,
    
    /// fee receiver - must be the authority in ProgramState
    #[account(
        mut, 
        address = program_state.authority
    )]
    pub authority: SystemAccount<'info>,
    
    /// Program state account
    #[account(
        mut,
        seeds = [PROGRAM_STATE_SEED],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,
    
    pub system_program: Program<'info, System>,
}

/// Withdraw all available SOL from program state account while preserving rent-exempt amount
pub fn withdraw_fees_handler(
    context: Context<WithdrawFeesAccountConstraints>,
) -> Result<()> {
    // Get account infos
    let program_state_info = context.accounts.program_state.to_account_info();
    let authority_info = context.accounts.authority.to_account_info();

    // Calculate minimum rent-exempt balance needed
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(ANCHOR_DISCRIMINATOR + ProgramState::INIT_SPACE);

    // Calculate available amount to withdraw
    let current_balance = program_state_info.lamports();
    let withdraw_amount = current_balance
        .checked_sub(min_rent)
        .ok_or(error!(CaRegistrarError::InsufficientPayment))?;

    // Verify there are funds to withdraw
    require!(withdraw_amount > 0, CaRegistrarError::InsufficientPayment);

    // Transfer all available balance except rent-exempt amount
    **program_state_info.try_borrow_mut_lamports()? -= withdraw_amount;
    **authority_info.try_borrow_mut_lamports()? += withdraw_amount;

    msg!("Withdrew {} lamports to authority", withdraw_amount);
    Ok(())
}
