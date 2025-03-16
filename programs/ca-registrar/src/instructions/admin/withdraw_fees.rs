#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, transfer};
use crate::constants::*;
use crate::state::*;
use crate::error::CaRegistrarError;

/// Account constraints for withdrawing fees instruction
/// 
/// This instruction allows the program administrator to withdraw SOL from the program state account.
#[derive(Accounts)]
pub struct WithdrawFeesAccountConstraints<'info> {
    /// Program administrator, must match the authority in ProgramState
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// Program state account
    #[account(
        mut,
        has_one = authority @ CaRegistrarError::NotProgramAuthority,
        seeds = [PROGRAM_STATE_SEED],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,
    
    pub system_program: Program<'info, System>,
}

/// Withdraw SOL from program state account
/// 
/// # Parameters
/// * `context` - Instruction context, containing all relevant accounts
/// * `amount` - Amount to withdraw (in lamports), if 0 then withdraw all available balance
pub fn withdraw_fees_handler(
    context: Context<WithdrawFeesAccountConstraints>,
    amount: u64,
) -> Result<()> {
    let program_state = &context.accounts.program_state;
    let authority = &context.accounts.authority;
    
    // Determine amount to withdraw
    let withdraw_amount = if amount == 0 {
        // Withdraw all balance, but reserve enough for rent exemption
        let rent = Rent::get()?;
        // Calculate minimum rent exemption balance needed for program state account
        let min_rent = rent.minimum_balance(ANCHOR_DISCRIMINATOR + ProgramState::INIT_SPACE);
        
        program_state.to_account_info().lamports()
            .checked_sub(min_rent)
            .ok_or(error!(CaRegistrarError::InsufficientPayment))?
    } else {
        // Withdraw specified amount
        let available = program_state.to_account_info().lamports()
            .checked_sub(Rent::get()?.minimum_balance(ANCHOR_DISCRIMINATOR + ProgramState::INIT_SPACE))
            .ok_or(error!(CaRegistrarError::InsufficientPayment))?;
            
        require!(
            available >= amount,
            CaRegistrarError::InsufficientPayment
        );
        amount
    };

    let signer_seeds: &[&[&[u8]]] = &[&[
        PROGRAM_STATE_SEED,
        &[context.accounts.program_state.bump],
    ]];

    // Transfer fee to administrator account using PDA signature
    transfer(
        CpiContext::new_with_signer(
            context.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: context.accounts.program_state.to_account_info(),
                to: authority.to_account_info(),
            },
            signer_seeds,
        ),
        withdraw_amount,
    )?;
    
    msg!("Withdrew {} lamports to authority", withdraw_amount);
    
    Ok(())
} 