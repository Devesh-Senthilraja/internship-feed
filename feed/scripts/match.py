"""Heuristic resume-match score and eligibility flags.

This is keyword overlap, not a prediction. Most community listings carry only
a title, so the score is coarse there; postings from company boards add the
description text and score more precisely. The UI says so.
"""
from __future__ import annotations

import re


def _has(text: str, term: str) -> bool:
    # Word-boundary match that still works for terms like "c++" and "i2c".
    return re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text) is not None


def score_posting(p: dict, profile: dict) -> dict:
    title = p["title"].lower()
    body = (p.get("description") or "").lower()
    score, reasons = 35, []

    bonus = profile["category_bonus"].get(p.get("category", ""), 0)
    if bonus:
        score += bonus
        reasons.append(f"{p['category']} category {bonus:+d}")

    for tier in ("strong", "medium", "light"):
        group = profile["keywords"][tier]
        for term in group["terms"]:
            if _has(title, term):
                score += group["weight"]
                reasons.append(f"title: {term}")
            elif body and _has(body, term):
                # Description hits count for less: boilerplate mentions a lot of things.
                score += group["weight"] // 3
                reasons.append(f"desc: {term}")

    neg = profile["negative"]
    for term in neg["terms"]:
        if _has(title, term):
            score += neg["weight"]
            reasons.append(f"title: {term} {neg['weight']:+d}")

    score = max(0, min(100, score))
    label = "High" if score >= 70 else "Medium" if score >= 50 else "Low"
    return {"score": score, "label": label, "reasons": reasons[:12]}


def eligibility_flags(p: dict, profile: dict) -> list[str]:
    title = p["title"].lower()
    text = title + " " + (p.get("description") or "").lower()
    flags = []
    if any(_has(text, t) for t in profile["underclass_terms"]) or \
            any(_has(title, t) for t in profile["underclass_title_terms"]):
        flags.append("underclass-friendly")
    if any(_has(text, t) for t in profile["upperclass_terms"]):
        flags.append("upperclass wording")
    if re.search(r"\b(phd|ph\.d|master'?s|mba)\b", title):
        flags.append("grad-level")
    if any(_has(text, t) for t in profile["export_control_terms"]):
        flags.append("ITAR / U.S. person: you qualify" if profile.get("us_person") else "export-control / U.S. person")

    # Graduation window check: years mentioned near "graduat..." in the description.
    grad = profile["grad_year"]
    years = set()
    for m in re.finditer(r"graduat\w*[^.]{0,80}", text):
        years.update(int(y) for y in re.findall(r"\b(20[2-3]\d)\b", m.group(0)))
    if years and max(years) < grad:
        flags.append(f"grad window may end before {grad}")
    return flags
